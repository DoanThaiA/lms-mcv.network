"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Circle, Download, ExternalLink, Eye, Film, Link2, Paperclip } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { documentPreview, embedVideoUrl, FilePreviewModal, type PreviewFile } from "@/components/file-preview";
import { RichContent } from "@/components/lesson/rich-content";
import { MetaBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, Textarea } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/api";
import { LESSON_KIND, REVIEW_STATUS } from "@/lib/labels";
import type {
  CourseProgress,
  DocumentDetail,
  LessonDetail,
  LessonProgress,
  QuizResult,
  Submission,
  SubmissionResult,
} from "@/lib/types";
import { cn, fmtBytes, fmtDateTime } from "@/lib/utils";

export type ProgressBody = { completed?: boolean; position_seconds?: number; video_completed?: boolean };

const SUBMISSION_MAX_MB = 20; // khớp settings.submission_max_mb (backend)
const MIN_TEXT_SUBMISSION = 20;
const isFileVideoUrl = (url: string) => /\.(mp4|webm|ogg|mov|m4v)(\?|$)/i.test(url);
const fmtClock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/**
 * Bài học chuẩn theo mẫu: Mục tiêu · Video · Nội dung · Câu hỏi kiểm tra · Tài liệu thực hành · Nộp bài · Hoàn thành.
 * Điều kiện hoàn thành: lý thuyết = xem hết video + đọc đến cuối; kiểm tra = xem hết video + trả lời đạt;
 * thực hành = nộp bài (tự hoàn thành khi nộp). Máy chủ kiểm tra lại khi đánh dấu hoàn thành.
 */
export function StandardLesson({
  courseId,
  lesson,
  progress,
  enrolled,
  report,
  completing,
  onProgress,
}: {
  courseId: number;
  lesson: LessonDetail;
  progress?: LessonProgress;
  enrolled: boolean;
  report?: (body: ProgressBody) => void;
  completing: boolean;
  onProgress: (p: CourseProgress) => void;
}) {
  const kind = lesson.lesson_kind ?? "theory";
  const completed = !!progress?.completed_at;
  const hasVideo = !!(lesson.document || lesson.external_url);
  const videoDone = !!progress?.video_completed_at;
  const [read, setRead] = useState(false);
  const sentinel = useRef<HTMLDivElement>(null);

  // Cuộn tới cuối nội dung = đã đọc hết
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        setRead(true);
        io.disconnect();
      }
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div className="space-y-6">
      {completed && (
        <p className="rounded-lg bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800 ring-1 ring-emerald-200">
          Bạn đã hoàn thành bài này
          {kind === "practice" ? " (đã nộp bài). Có thể nộp lại nếu cần sửa." : "."}
        </p>
      )}

      {lesson.goals.length > 0 && (
        <div className="rounded-lg border border-line border-l-4 border-l-brand bg-surface px-5 py-4">
          <h2 className="mb-1.5 font-semibold">🎯 Mục tiêu bài học</h2>
          <ul className="list-disc space-y-1 pl-5 text-[15px]">
            {lesson.goals.map((g, i) => (
              <li key={i}>{g}</li>
            ))}
          </ul>
        </div>
      )}

      <section>
        <SectionTitle>🎬 Video của giảng viên</SectionTitle>
        <LessonVideo lesson={lesson} progress={progress} enrolled={enrolled} report={report} />
      </section>

      {lesson.body?.trim() && (
        <section>
          <SectionTitle>📖 Nội dung</SectionTitle>
          <div className="rounded-lg border border-line px-5 py-4">
            <RichContent html={lesson.body} />
          </div>
        </section>
      )}

      {kind === "quiz" && lesson.quiz && (
        <section>
          <SectionTitle>❓ Câu hỏi kiểm tra</SectionTitle>
          <QuizBox
            courseId={courseId}
            lesson={lesson}
            progress={progress}
            enrolled={enrolled}
            onProgress={onProgress}
          />
        </section>
      )}

      <div ref={sentinel} className="h-px" />

      {lesson.practice_documents.length > 0 && (
        <section>
          <SectionTitle>📎 Tài liệu thực hành</SectionTitle>
          <PracticeDocuments docs={lesson.practice_documents} />
        </section>
      )}

      {kind === "practice" && lesson.assignment && (
        <section>
          <SectionTitle>📤 Nộp bài</SectionTitle>
          <SubmitBox courseId={courseId} lesson={lesson} enrolled={enrolled} onProgress={onProgress} />
        </section>
      )}

      {kind !== "practice" && (
        <section>
          <SectionTitle>✅ Hoàn thành bài</SectionTitle>
          <div className="rounded-lg border border-line bg-subtle/40 px-5 py-4">
            {hasVideo && <CheckRow ok={videoDone}>Xem hết video của giảng viên</CheckRow>}
            {kind === "theory" && <CheckRow ok={read || completed}>Đọc đến cuối nội dung bài</CheckRow>}
            {kind === "quiz" && <CheckRow ok={!!progress?.quiz_passed_at}>{quizRule(lesson.quiz!)}</CheckRow>}
            <div className="mt-3">
              {!enrolled ? (
                <p className="text-[13px] text-ink-3">Chế độ xem trước: không ghi nhận hoàn thành.</p>
              ) : completed ? (
                <span className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-700">
                  <CheckCircle2 className="size-4" /> Đã hoàn thành
                </span>
              ) : (
                <Button
                  variant="primary"
                  icon={<CheckCircle2 className="size-4" />}
                  loading={completing}
                  disabled={
                    (hasVideo && !videoDone) ||
                    (kind === "theory" && !read) ||
                    (kind === "quiz" && !progress?.quiz_passed_at)
                  }
                  onClick={() => report?.({ completed: true })}
                >
                  Đánh dấu hoàn thành
                </Button>
              )}
            </div>
          </div>
        </section>
      )}

      <p className="text-xs text-ink-3">
        <MetaBadge meta={LESSON_KIND[kind]} dot={false} /> <span className="ml-1">{LESSON_KIND[kind].done}.</span>
      </p>
    </div>
  );
}

function quizRule(quiz: NonNullable<LessonDetail["quiz"]>) {
  if (!quiz.pass_score) return "Trả lời đúng tất cả câu hỏi";
  const must = quiz.must_correct.length ? ` và đúng câu ${quiz.must_correct.map((i) => i + 1).join(", ")}` : "";
  return `Trả lời đúng tối thiểu ${quiz.pass_score}/${quiz.questions.length} câu${must}`;
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-2.5 text-base font-semibold text-brand-hover">{children}</h2>;
}

function CheckRow({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <p className={cn("flex items-center gap-2 py-1 text-sm", ok ? "text-emerald-800" : "text-ink-2")}>
      {ok ? <CheckCircle2 className="size-4 text-emerald-600" /> : <Circle className="size-4 text-line-strong" />}
      {children}
    </p>
  );
}

// ---------------------------------------------------------------- Video

function LessonVideo({
  lesson,
  progress,
  enrolled,
  report,
}: {
  lesson: LessonDetail;
  progress?: LessonProgress;
  enrolled: boolean;
  report?: (body: ProgressBody) => void;
}) {
  const doc = lesson.document;
  const url = lesson.external_url;
  const done = !!progress?.video_completed_at;
  const startAt = progress?.last_position_seconds ?? 0;
  const track = enrolled ? report : undefined;

  if (doc?.preview_kind === "video" || (!doc && url && isFileVideoUrl(url))) {
    return (
      <TrackedVideo
        src={doc ? (doc.preview_url ?? doc.download_url) : url!}
        startAt={startAt}
        done={done}
        report={track}
      />
    );
  }
  if (url) {
    const embed = embedVideoUrl(url);
    return (
      <>
        {embed ? (
          <iframe
            src={embed}
            title={lesson.title}
            className="aspect-video w-full rounded-lg bg-black"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
            allowFullScreen
          />
        ) : (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex aspect-video w-full flex-col items-center justify-center gap-3 rounded-lg bg-[#0e1a28] text-slate-200"
          >
            <ExternalLink className="size-8" />
            <span className="max-w-[80%] truncate text-sm">{url}</span>
            <span className="rounded-md bg-white/15 px-3 py-1 text-sm">Mở video ở tab mới</span>
          </a>
        )}
        <WatchTimer
          key={lesson.id}
          initial={startAt}
          needSeconds={Math.round((lesson.video_minutes || 3) * 60 * 0.9)}
          done={done}
          report={track}
        />
      </>
    );
  }
  if (doc) {
    // File trong thư viện nhưng không phải video: cho xem / tải như tài liệu
    return <PracticeDocuments docs={[doc]} />;
  }
  return (
    <div className="flex aspect-video w-full flex-col items-center justify-center gap-1.5 rounded-lg bg-[#0e1a28] px-6 text-center text-slate-300">
      <Film className="size-9" />
      <p>Video của giảng viên cho bài này đang được cập nhật.</p>
      <p className="text-sm text-slate-400">Bạn vẫn học được từ nội dung bên dưới.</p>
    </div>
  );
}

/** File video: nhớ vị trí, không tua qua phần chưa xem, xem tới 95% là đã xem hết. */
function TrackedVideo({
  src,
  startAt,
  done,
  report,
}: {
  src: string;
  startAt: number;
  done: boolean;
  report?: (body: ProgressBody) => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const maxSeen = useRef(startAt);
  const lastSaved = useRef(startAt);
  const fired = useRef(false);
  const [status, setStatus] = useState({ seen: startAt, duration: 0 });

  const watched = (t: number) => {
    if (done || fired.current || !report) return;
    fired.current = true;
    report({ position_seconds: Math.floor(t), video_completed: true });
  };
  const save = () => {
    const t = Math.floor(ref.current?.currentTime ?? 0);
    if (!report || t === lastSaved.current) return;
    lastSaved.current = t;
    report({ position_seconds: t });
  };

  return (
    <>
      <video
        ref={ref}
        src={src}
        controls
        preload="metadata"
        className="aspect-video w-full rounded-lg bg-black"
        onLoadedMetadata={() => {
          const v = ref.current;
          if (!v) return;
          if (startAt > 0 && startAt < v.duration - 5) v.currentTime = startAt;
          setStatus((s) => ({ ...s, duration: v.duration }));
        }}
        onSeeking={() => {
          const v = ref.current;
          if (v && !done && report && v.currentTime > maxSeen.current + 2) v.currentTime = maxSeen.current;
        }}
        onTimeUpdate={() => {
          const v = ref.current;
          if (!v) return;
          const t = v.currentTime;
          if (t > maxSeen.current && t <= maxSeen.current + 2) maxSeen.current = t;
          if (Math.abs(t - lastSaved.current) >= 15) save();
          if (v.duration && maxSeen.current >= v.duration * 0.95) watched(t);
          if (Math.floor(maxSeen.current) !== Math.floor(status.seen)) {
            setStatus({ seen: maxSeen.current, duration: v.duration || 0 });
          }
        }}
        onPause={save}
        onEnded={() => watched(ref.current?.duration ?? 0)}
      />
      <p className="mt-1.5 text-[13px] text-ink-3">
        {done
          ? "✓ Đã xem hết video"
          : !report
            ? "Chế độ xem trước: không ghi nhận thời gian xem."
            : status.duration
              ? `Đã xem ${fmtClock(status.seen)} / ${fmtClock(status.duration)} — xem hết video để hoàn thành bài (không tua qua phần chưa xem).`
              : "Xem hết video để hoàn thành bài."}
      </p>
    </>
  );
}

/** Video nhúng (YouTube / Vimeo / Drive): đếm thời gian trang mở và đang hiển thị, đủ 90% thời lượng là đã xem. */
function WatchTimer({
  initial,
  needSeconds,
  done,
  report,
}: {
  initial: number;
  needSeconds: number;
  done: boolean;
  report?: (body: ProgressBody) => void;
}) {
  const [seconds, setSeconds] = useState(initial);
  const counter = useRef(initial);
  const reportRef = useRef(report);
  useEffect(() => {
    reportRef.current = report;
  }, [report]);

  useEffect(() => {
    if (done || !report) return;
    const id = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      counter.current += 1;
      setSeconds(counter.current);
      if (counter.current >= needSeconds) {
        clearInterval(id);
        reportRef.current?.({ position_seconds: counter.current, video_completed: true });
      } else if (counter.current % 15 === 0) {
        reportRef.current?.({ position_seconds: counter.current });
      }
    }, 1000);
    return () => clearInterval(id);
  }, [done, needSeconds, report]);

  return (
    <p className="mt-1.5 text-[13px] text-ink-3">
      {done
        ? "✓ Đã xem hết video"
        : !report
          ? "Chế độ xem trước: không ghi nhận thời gian xem."
          : `Đã mở video ${Math.floor(seconds / 60)}/${Math.ceil(needSeconds / 60)} phút (giữ trang này mở khi xem; cần đủ thời lượng video mới tính là đã xem).`}
    </p>
  );
}

// ---------------------------------------------------------------- Câu hỏi kiểm tra

type Graded = Pick<QuizResult, "score" | "total" | "pass_score" | "passed" | "results">;

function QuizBox({
  courseId,
  lesson,
  progress,
  enrolled,
  onProgress,
}: {
  courseId: number;
  lesson: LessonDetail;
  progress?: LessonProgress;
  enrolled: boolean;
  onProgress: (p: CourseProgress) => void;
}) {
  const toast = useToast();
  const quiz = lesson.quiz!;
  const [answers, setAnswers] = useState<(number | null)[]>(() => quiz.questions.map(() => null));
  const [graded, setGraded] = useState<Graded | null>(null);
  const [message, setMessage] = useState("");

  const submit = useMutation({
    mutationFn: async (picked: number[]) => {
      if (!enrolled) {
        // Xem trước (người soạn có đáp án): chấm ngay trên trình duyệt, không ghi nhận
        const results = quiz.questions.map((q, i) => ({ correct: picked[i] === q.answer, explanation: q.explanation }));
        const score = results.filter((r) => r.correct).length;
        const need = quiz.pass_score ?? quiz.questions.length;
        const passed = score >= need && quiz.must_correct.every((i) => results[i]?.correct);
        return { score, total: results.length, pass_score: need, passed, results } as Graded;
      }
      const res = await api.post<QuizResult>(`/me/courses/${courseId}/lessons/${lesson.id}/quiz`, { answers: picked });
      onProgress(res.data.progress);
      return res.data as Graded;
    },
    onSuccess: (r) => {
      setGraded(r);
      setMessage("");
    },
    onError: toast.error,
  });

  const passedBefore = !!progress?.quiz_passed_at;

  return (
    <div className="rounded-lg border border-line">
      {passedBefore && (
        <p className="border-b border-line bg-emerald-50 px-4 py-2 text-[13px] text-emerald-800">
          Bạn đã đạt phần kiểm tra ({progress?.quiz_score}/{quiz.questions.length} câu, {progress?.quiz_attempts} lần
          làm). Có thể làm lại để ôn tập.
        </p>
      )}
      <ol className="divide-y divide-line">
        {quiz.questions.map((q, i) => {
          const r = graded?.results[i];
          return (
            <li key={i} className={cn("px-4 py-3", r && (r.correct ? "bg-emerald-50/70" : "bg-red-50/70"))}>
              <p className="mb-1.5 font-medium">
                {i + 1}. {q.question}
              </p>
              <div className="space-y-0.5">
                {q.options.map((o, j) => (
                  <label
                    key={j}
                    className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-subtle"
                  >
                    <input
                      type="radio"
                      name={`q-${lesson.id}-${i}`}
                      className="size-4 accent-brand"
                      checked={answers[i] === j}
                      onChange={() => {
                        setAnswers((a) => a.map((x, k) => (k === i ? j : x)));
                        setGraded(null);
                      }}
                    />
                    {o}
                  </label>
                ))}
              </div>
              {r && (
                <p className={cn("mt-1.5 text-[13px]", r.correct ? "text-emerald-800" : "text-red-700")}>
                  {r.correct ? "✓ Đúng." : "✗ Chưa đúng."} {r.explanation}
                </p>
              )}
            </li>
          );
        })}
      </ol>
      <div className="flex flex-wrap items-center gap-3 border-t border-line px-4 py-3">
        <Button
          variant="primary"
          loading={submit.isPending}
          onClick={() => {
            const missing = answers.filter((a) => a === null).length;
            if (missing) {
              setMessage(`Còn ${missing} câu chưa trả lời.`);
              return;
            }
            submit.mutate(answers as number[]);
          }}
        >
          Chấm điểm
        </Button>
        {message && <span className="text-[13px] text-danger">{message}</span>}
        {graded && (
          <span className={cn("text-sm font-semibold", graded.passed ? "text-emerald-700" : "text-red-700")}>
            {graded.passed
              ? `Đạt ${graded.score}/${graded.total}.`
              : `Chưa đạt (${graded.score}/${graded.total}). Điều kiện: ${quizRule(quiz).toLowerCase()}. Xem giải thích và làm lại.`}
          </span>
        )}
        {!enrolled && <span className="text-xs text-ink-3">Xem trước: chấm trên trình duyệt, không lưu.</span>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Tài liệu thực hành

function PracticeDocuments({ docs }: { docs: DocumentDetail[] }) {
  const [preview, setPreview] = useState<PreviewFile | null>(null);
  return (
    <>
      <ul className="divide-y divide-line rounded-lg border border-line">
        {docs.map((d) => {
          const ext = d.file_name.includes(".") ? d.file_name.split(".").pop()!.toUpperCase().slice(0, 4) : "FILE";
          const pv = documentPreview(d);
          return (
            <li key={d.id} className="flex items-center gap-3 px-4 py-2.5">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-subtle text-[11px] font-bold text-ink-2">
                {ext}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{d.title}</span>
                <span className="block truncate text-xs text-ink-3">
                  {d.description || d.file_name} · {fmtBytes(d.size_bytes)}
                </span>
              </span>
              {pv && (
                <Button size="sm" variant="ghost" icon={<Eye className="size-4" />} onClick={() => setPreview(pv)}>
                  Xem
                </Button>
              )}
              {d.download_url && (
                <a href={d.download_url} target="_blank" rel="noopener noreferrer">
                  <Button size="sm" icon={<Download className="size-4" />}>
                    Tải về
                  </Button>
                </a>
              )}
            </li>
          );
        })}
      </ul>
      {preview && <FilePreviewModal file={preview} onClose={() => setPreview(null)} />}
    </>
  );
}

// ---------------------------------------------------------------- Nộp bài

function SubmitBox({
  courseId,
  lesson,
  enrolled,
  onProgress,
}: {
  courseId: number;
  lesson: LessonDetail;
  enrolled: boolean;
  onProgress: (p: CourseProgress) => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const assignment = lesson.assignment!;
  const url = `/me/courses/${courseId}/lessons/${lesson.id}/submissions`;
  const history = useQuery({
    queryKey: ["my-submissions", lesson.id],
    queryFn: async () => (await api.get<Submission[]>(url)).data,
    enabled: enrolled,
  });
  const fileRef = useRef<HTMLInputElement>(null);
  const [link, setLink] = useState("");
  const [note, setNote] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [selfCheck, setSelfCheck] = useState(false);
  const [error, setError] = useState("");

  const submit = useMutation({
    mutationFn: async () => {
      const fd = new FormData();
      if (link.trim()) fd.append("link", link.trim());
      if (note.trim()) fd.append("note", note.trim());
      files.forEach((f) => fd.append("files", f));
      return (await api.post<SubmissionResult>(url, fd)).data;
    },
    onSuccess: (data) => {
      onProgress(data.progress);
      qc.invalidateQueries({ queryKey: ["my-submissions", lesson.id] });
      setLink("");
      setNote("");
      setFiles([]);
      setSelfCheck(false);
      if (fileRef.current) fileRef.current.value = "";
      toast.success("Đã nộp bài cho giảng viên");
    },
    onError: toast.error,
  });

  const onSubmit = () => {
    const textOk = assignment.allow_text && note.trim().length >= MIN_TEXT_SUBMISSION;
    if (!link.trim() && !files.length && !textOk) {
      return setError(
        `Cần gửi link hoặc tải ít nhất 1 file kết quả${assignment.allow_text ? " (hoặc điền nội dung bài vào ô ghi chú)" : ""}.`,
      );
    }
    if (link.trim() && !/^https?:\/\/\S+\.\S+$/.test(link.trim())) {
      return setError("Link chưa đúng định dạng (cần bắt đầu bằng https://).");
    }
    if (files.some((f) => f.size > SUBMISSION_MAX_MB * 1024 * 1024)) {
      return setError(`Có file lớn hơn ${SUBMISSION_MAX_MB} MB. Hãy gửi qua link Drive.`);
    }
    if (!selfCheck) return setError("Hãy tự kiểm bài theo tiêu chí đạt và đánh dấu ô xác nhận.");
    setError("");
    submit.mutate();
  };

  return (
    <div className="rounded-lg border border-line px-5 py-4">
      <p className="text-[15px]">
        <b>Bài nộp cần có:</b> {assignment.requirement}
      </p>
      {assignment.criteria.length > 0 && (
        <>
          <p className="mt-2 font-semibold">Tiêu chí đạt:</p>
          <ul className="list-disc space-y-0.5 pl-5 text-[15px]">
            {assignment.criteria.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </>
      )}

      {!enrolled ? (
        <p className="mt-4 rounded-lg bg-subtle px-3 py-2 text-[13px] text-ink-3">
          Chế độ xem trước: học viên nộp link / file kết quả tại đây.
        </p>
      ) : (
        <div className="mt-4 grid gap-3">
          <Field label="Link kết quả" hint='Đặt quyền xem "Bất kỳ ai có đường liên kết" hoặc chia sẻ cho giảng viên.'>
            {(id) => (
              <Input
                id={id}
                type="url"
                placeholder="https://drive.google.com/..."
                value={link}
                onChange={(e) => setLink(e.target.value)}
              />
            )}
          </Field>
          <Field
            label="Hoặc tải file kết quả"
            hint={`Tối đa ${SUBMISSION_MAX_MB} MB mỗi file. Không tải file chứa dữ liệu mật.`}
          >
            {(id) => (
              <input
                id={id}
                ref={fileRef}
                type="file"
                multiple
                className="text-sm file:mr-3 file:rounded-md file:border file:border-line-strong file:bg-surface file:px-3 file:py-1.5 file:text-sm"
                onChange={(e) => setFiles([...(e.target.files ?? [])])}
              />
            )}
          </Field>
          <Field label={`Ghi chú cho giảng viên${assignment.allow_text ? " (có thể điền nội dung bài ở đây)" : ""}`}>
            {(id) => (
              <Textarea
                id={id}
                rows={3}
                placeholder={
                  assignment.allow_text
                    ? "Dán nội dung bài làm vào đây..."
                    : "Khó khăn, điểm người kiểm chấm, câu hỏi..."
                }
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            )}
          </Field>
          <Checkbox
            label="Tôi đã tự kiểm bài theo tiêu chí đạt"
            checked={selfCheck}
            onChange={(e) => setSelfCheck(e.target.checked)}
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary" loading={submit.isPending} onClick={onSubmit}>
              Nộp bài
            </Button>
            {error && <span className="text-[13px] text-danger">{error}</span>}
          </div>
        </div>
      )}

      {history.data && history.data.length > 0 && (
        <div className="mt-5 border-t border-line pt-3">
          <p className="mb-2 text-[13px] font-medium text-ink-2">Bài đã nộp</p>
          <SubmissionList items={history.data} />
        </div>
      )}
    </div>
  );
}

/** Danh sách bài nộp (học viên xem bài của mình; người quản lý xem trong tiến độ học viên). */
export function SubmissionList({
  items,
  actions,
}: {
  items: Submission[];
  actions?: (s: Submission) => React.ReactNode;
}) {
  return (
    <ul className="space-y-2">
      {items.map((s) => (
        <li key={s.id} className="rounded-lg border border-line px-3 py-2 text-[13px]">
          <div className="flex flex-wrap items-center gap-2">
            <MetaBadge meta={REVIEW_STATUS[s.review_status]} />
            <span className="text-ink-3">Nộp {fmtDateTime(s.created_at)}</span>
            {actions && <span className="ml-auto">{actions(s)}</span>}
          </div>
          {s.link && (
            <a
              href={s.link}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 flex items-center gap-1.5 break-all text-brand hover:underline"
            >
              <Link2 className="size-3.5 shrink-0" /> {s.link}
            </a>
          )}
          {s.files.map((f) => (
            <a
              key={f.download_url || f.file_name}
              href={f.download_url || undefined}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 flex items-center gap-1.5 text-brand hover:underline"
            >
              <Paperclip className="size-3.5 shrink-0" /> {f.file_name}
              <span className="text-ink-3">· {fmtBytes(f.size_bytes)}</span>
            </a>
          ))}
          {s.note && <p className="mt-1 whitespace-pre-wrap text-ink-2">{s.note}</p>}
          {s.review_note && (
            <p className="mt-1.5 rounded-md bg-subtle px-2 py-1 whitespace-pre-wrap">
              <b>Nhận xét:</b> {s.review_note}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}
