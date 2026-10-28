"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, ChevronLeft, ChevronRight, Circle, Download, ExternalLink, Eye } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

import { embedVideoUrl } from "@/components/file-preview";
import { MetaBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, Empty, ProgressBar, Spinner } from "@/components/ui/misc";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useCourse, useMyProgress, useNumberParam } from "@/lib/hooks";
import { LESSON_TYPE } from "@/lib/labels";
import type { CourseProgress, DocumentDetail, LessonDetail } from "@/lib/types";
import { cn, fmtBytes, fmtMinutes, fmtPercent, num } from "@/lib/utils";

const officeViewer = (url: string) => `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(url)}`;

type Report = (body: { completed?: boolean; position_seconds?: number }) => void;

/** Video trong thư viện: mở lại đúng vị trí đã xem, lưu vị trí mỗi 15 giây / khi dừng, xem hết thì hoàn thành. */
function FileVideo({ doc, startAt, report }: { doc: DocumentDetail; startAt: number; report?: Report }) {
  const ref = useRef<HTMLVideoElement>(null);
  const lastSaved = useRef(0);
  const save = (completed = false) => {
    const t = Math.floor(ref.current?.currentTime ?? 0);
    lastSaved.current = t;
    report?.({ position_seconds: t, ...(completed ? { completed: true } : {}) });
  };
  return (
    <video
      ref={ref}
      src={doc.preview_url ?? doc.download_url}
      controls
      className="aspect-video w-full rounded-lg bg-black"
      onLoadedMetadata={() => {
        if (ref.current && startAt > 0 && startAt < ref.current.duration - 5) ref.current.currentTime = startAt;
      }}
      onTimeUpdate={() => {
        const t = ref.current?.currentTime ?? 0;
        if (report && Math.abs(t - lastSaved.current) >= 15) save();
      }}
      onPause={() => report && save()}
      onEnded={() => report && save(true)}
    />
  );
}

function DocumentView({ doc }: { doc: DocumentDetail }) {
  const kind = doc.preview_kind;
  const src = doc.preview_url;
  return (
    <div className="space-y-3">
      {src && (kind === "pdf" || kind === "text" || kind === "office") ? (
        <iframe
          src={kind === "office" ? officeViewer(src) : src}
          title={doc.title}
          className="h-[75vh] w-full rounded-lg border border-line bg-white"
        />
      ) : src && kind === "image" ? (
        // eslint-disable-next-line @next/next/no-img-element -- file trên R2 qua link ký tạm
        <img src={src} alt={doc.title} className="mx-auto max-h-[75vh] rounded-lg object-contain" />
      ) : src && kind === "audio" ? (
        <audio src={src} controls className="w-full" />
      ) : (
        <Empty title="Tài liệu này không xem trực tiếp được" description="Tải về để mở trên máy." />
      )}
      <div className="flex flex-wrap items-center gap-2 text-[13px] text-ink-3">
        <span className="mr-auto truncate">
          {doc.file_name} · {fmtBytes(doc.size_bytes)}
        </span>
        {src && (
          <a href={kind === "office" ? officeViewer(src) : src} target="_blank" rel="noopener noreferrer">
            <Button size="sm" icon={<Eye className="size-4" />}>
              Mở tab mới
            </Button>
          </a>
        )}
        {doc.download_url && (
          <a href={doc.download_url} target="_blank" rel="noopener noreferrer">
            <Button size="sm" icon={<Download className="size-4" />}>
              Tải về
            </Button>
          </a>
        )}
      </div>
    </div>
  );
}

function LessonContent({ lesson, startAt, report }: { lesson: LessonDetail; startAt: number; report?: Report }) {
  const doc = lesson.document;
  const url = lesson.external_url;
  const embed = url ? embedVideoUrl(url) : null;

  switch (lesson.content_type) {
    case "text":
      return <div className="lesson-prose text-ink">{lesson.body}</div>;
    case "video":
      if (doc?.preview_kind === "video") return <FileVideo doc={doc} startAt={startAt} report={report} />;
      if (embed) {
        return (
          <iframe
            src={embed}
            title={lesson.title}
            className="aspect-video w-full rounded-lg bg-black"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        );
      }
      if (doc) return <DocumentView doc={doc} />;
      return url ? <ExternalCard url={url} /> : null;
    case "document":
      return doc ? <DocumentView doc={doc} /> : <Empty title="Tài liệu đã bị xoá khỏi thư viện" />;
    case "link":
      return url ? <ExternalCard url={url} /> : null;
  }
}

function ExternalCard({ url }: { url: string }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-line-strong px-4 py-10 text-center">
      <ExternalLink className="size-6 text-ink-3" />
      <p className="max-w-full truncate text-ink-2">{url}</p>
      <a href={url} target="_blank" rel="noopener noreferrer">
        <Button variant="primary" icon={<ExternalLink className="size-4" />}>
          Mở nội dung
        </Button>
      </a>
    </div>
  );
}

export default function LearnPage() {
  const courseId = useNumberParam("id");
  const lessonId = useNumberParam("lessonId");
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const { can } = useAuth();
  const course = useCourse(courseId);
  const progress = useMyProgress(courseId);
  const lesson = useQuery({
    queryKey: ["lessons", lessonId],
    queryFn: async () => (await api.get<LessonDetail>(`/courses/${courseId}/lessons/${lessonId}`)).data,
    staleTime: 30 * 60_000, // link file ký tạm 1 giờ: không tải lại khi đang học
  });

  const enrolled = !!progress.data;
  const record = useMutation({
    mutationFn: async (body: { completed?: boolean; position_seconds?: number }) =>
      (await api.post<CourseProgress>(`/me/courses/${courseId}/lessons/${lessonId}/progress`, body)).data,
    onSuccess: (data, body) => {
      const wasCompleted = progress.data?.enrollment.status === "completed";
      qc.setQueryData(["my-progress", courseId], data);
      qc.invalidateQueries({ queryKey: ["my-courses"] });
      if (body.completed && data.enrollment.status === "completed" && !wasCompleted) {
        toast.success("Chúc mừng! Bạn đã hoàn thành khoá học");
      }
    },
    onError: toast.error,
  });
  const report = enrolled ? (body: Parameters<Report>[0]) => record.mutate(body) : undefined;

  // Mở bài = bắt đầu học (ghi nhận một lần cho mỗi bài)
  const touched = useRef<number | null>(null);
  const { mutate } = record;
  useEffect(() => {
    if (enrolled && lesson.data && touched.current !== lesson.data.id) {
      touched.current = lesson.data.id;
      mutate({});
    }
  }, [enrolled, lesson.data, mutate]);

  if (course.isPending || lesson.isPending || progress.isPending) return <Spinner />;
  if (!course.data || !lesson.data) {
    return (
      <Card>
        <Empty
          title="Không mở được bài học"
          description={lesson.error ? "Bạn cần đăng ký khoá học trước khi học." : undefined}
          action={<Link href={`/courses/${courseId}`} className="text-brand hover:underline">Về trang khoá học</Link>}
        />
      </Card>
    );
  }

  const c = course.data;
  const l = lesson.data;
  const lessons = c.lessons;
  const index = lessons.findIndex((x) => x.id === l.id);
  const prev = lessons[index - 1];
  const next = lessons[index + 1];
  const byLesson = new Map((progress.data?.lessons ?? []).map((p) => [p.lesson_id, p]));
  const completed = !!byLesson.get(l.id)?.completed_at;
  const enrollment = progress.data?.enrollment;
  const go = (id: number) => router.push(`/courses/${courseId}/learn/${id}`);

  return (
    <>
      <Link href={`/courses/${courseId}`} className="mb-3 inline-flex items-center gap-1 text-[13px] text-ink-3 hover:text-ink">
        <ArrowLeft className="size-4" /> {c.code} · {c.title}
      </Link>

      {!enrolled && can("content.manage") && (
        <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-[13px] text-amber-800 ring-1 ring-amber-200">
          Chế độ xem trước — bạn không ghi danh khoá học này nên tiến độ không được ghi nhận.
        </p>
      )}

      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <Card className="min-w-0">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
            <div className="min-w-0">
              <p className="text-xs text-ink-3">
                Bài {index + 1}/{lessons.length}
              </p>
              <h1 className="text-lg font-semibold">{l.title}</h1>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-3">
                <MetaBadge meta={LESSON_TYPE[l.content_type]} dot={false} />
                {l.duration_minutes ? fmtMinutes(l.duration_minutes) : null}
                {!l.is_required && <span>Không bắt buộc</span>}
              </div>
            </div>
            {enrolled &&
              (completed ? (
                <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-emerald-700">
                  <CheckCircle2 className="size-4" /> Đã hoàn thành
                </span>
              ) : (
                <Button
                  variant="primary"
                  icon={<CheckCircle2 className="size-4" />}
                  loading={record.isPending && !!record.variables?.completed}
                  onClick={() => record.mutate({ completed: true })}
                >
                  Đánh dấu hoàn thành
                </Button>
              ))}
          </div>

          <div className="px-5 py-5">
            <LessonContent
              lesson={l}
              startAt={byLesson.get(l.id)?.last_position_seconds ?? 0}
              report={report}
            />
            {l.content_type !== "text" && l.body && (
              <div className="mt-5 rounded-lg bg-subtle/70 px-4 py-3">
                <p className="mb-1 text-xs font-medium text-ink-3">Ghi chú</p>
                <div className="lesson-prose text-ink-2">{l.body}</div>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between gap-2 border-t border-line px-5 py-3">
            <Button icon={<ChevronLeft className="size-4" />} disabled={!prev} onClick={() => prev && go(prev.id)}>
              Bài trước
            </Button>
            {next ? (
              <Button
                variant={completed || !enrolled ? "primary" : "secondary"}
                onClick={() => {
                  if (enrolled && !completed && l.content_type !== "video") record.mutate({ completed: true });
                  go(next.id);
                }}
              >
                {enrolled && !completed && l.content_type !== "video" ? "Hoàn thành & bài tiếp" : "Bài tiếp"}
                <ChevronRight className="size-4" />
              </Button>
            ) : (
              <Link href={`/courses/${courseId}`}>
                <Button variant="primary">Về trang khoá học</Button>
              </Link>
            )}
          </div>
        </Card>

        <Card className="h-fit lg:sticky lg:top-6">
          {enrollment && (
            <div className="space-y-1.5 border-b border-line px-4 py-3">
              <div className="flex justify-between text-[13px]">
                <span className="text-ink-3">Tiến độ khoá học</span>
                <span className="font-medium tabular-nums">{fmtPercent(enrollment.progress_percent)}</span>
              </div>
              <ProgressBar value={num(enrollment.progress_percent)} />
            </div>
          )}
          <ol className="max-h-[70vh] overflow-y-auto py-1">
            {lessons.map((x, i) => {
              const done = !!byLesson.get(x.id)?.completed_at;
              const current = x.id === l.id;
              return (
                <li key={x.id}>
                  <Link
                    href={`/courses/${courseId}/learn/${x.id}`}
                    aria-current={current ? "page" : undefined}
                    className={cn(
                      "flex items-center gap-2.5 px-4 py-2 text-[13px] hover:bg-subtle",
                      current && "bg-brand-soft font-medium text-brand",
                    )}
                  >
                    {done ? (
                      <CheckCircle2 className="size-4 shrink-0 text-emerald-600" />
                    ) : (
                      <Circle className="size-4 shrink-0 text-line-strong" />
                    )}
                    <span className="min-w-0 flex-1 truncate">
                      {i + 1}. {x.title}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ol>
        </Card>
      </div>
    </>
  );
}
