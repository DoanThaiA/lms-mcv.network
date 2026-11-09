"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Plus, Trash2, X } from "lucide-react";
import { useRef, useState } from "react";

import { DocumentPickerModal } from "@/components/document/document-picker";
import { RichContent } from "@/components/lesson/rich-content";
import { Button, IconButton } from "@/components/ui/button";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/form";
import { Modal } from "@/components/ui/modal";
import { Spinner } from "@/components/ui/misc";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/api";
import { LESSON_KIND, LESSON_TYPE } from "@/lib/labels";
import type { DocumentItem, LessonDetail, LessonKind, LessonType } from "@/lib/types";
import { cn } from "@/lib/utils";

const HINTS: Record<LessonType, string> = {
  standard: "Theo mẫu: Mục tiêu · Video · Nội dung · Câu hỏi kiểm tra · Tài liệu thực hành · Nộp bài",
  text: "Nội dung bài đọc gõ trực tiếp",
  video: "File video trong thư viện, hoặc link YouTube / Vimeo / trang khác",
  document: "Tài liệu trong thư viện (PDF, Word, PowerPoint…) xem ngay trên trình duyệt",
  link: "Trang web bên ngoài, học viên mở ở tab mới",
};

const TYPE_ORDER: LessonType[] = ["standard", "text", "video", "document", "link"];
const KIND_ORDER: LessonKind[] = ["theory", "quiz", "practice"];

type DocRef = Pick<DocumentItem, "id" | "title" | "file_name">;
type QuestionDraft = { question: string; options: string[]; answer: number; explanation: string; must: boolean };

const lines = (s: string) =>
  s
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);

const emptyQuestion = (): QuestionDraft => ({
  question: "",
  options: ["", ""],
  answer: 0,
  explanation: "",
  must: false,
});

/** Thêm bài học (lessonId undefined) hoặc sửa bài học. */
export function LessonFormModal({
  courseId,
  lessonId,
  onClose,
}: {
  courseId: number;
  lessonId?: number;
  onClose: () => void;
}) {
  const detail = useQuery({
    queryKey: ["lessons", lessonId],
    queryFn: async () => (await api.get<LessonDetail>(`/courses/${courseId}/lessons/${lessonId}`)).data,
    enabled: lessonId !== undefined,
    gcTime: 0,
  });
  if (lessonId !== undefined && detail.isPending) {
    return (
      <Modal open onClose={onClose} title="Sửa bài học">
        <Spinner />
      </Modal>
    );
  }
  return <LessonForm courseId={courseId} lesson={detail.data} onClose={onClose} />;
}

function LessonForm({ courseId, lesson, onClose }: { courseId: number; lesson?: LessonDetail; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState({
    title: lesson?.title ?? "",
    content_type: lesson?.content_type ?? ("standard" as LessonType),
    lesson_kind: lesson?.lesson_kind ?? ("theory" as LessonKind),
    body: lesson?.body ?? "",
    external_url: lesson?.external_url ?? "",
    document_id: lesson?.document_id ?? null,
    duration_minutes: lesson?.duration_minutes?.toString() ?? "",
    video_minutes: lesson?.video_minutes?.toString() ?? "",
    is_required: lesson?.is_required ?? true,
    goals: (lesson?.goals ?? []).join("\n"),
    // Câu hỏi kiểm tra
    pass_all: lesson?.quiz ? lesson.quiz.pass_score === null : true,
    pass_score: lesson?.quiz?.pass_score?.toString() ?? "",
    // Nộp bài
    requirement: lesson?.assignment?.requirement ?? "",
    criteria: (lesson?.assignment?.criteria ?? []).join("\n"),
    allow_text: lesson?.assignment?.allow_text ?? false,
  });
  const [questions, setQuestions] = useState<QuestionDraft[]>(
    lesson?.quiz?.questions.map((q, i) => ({
      question: q.question,
      options: q.options,
      answer: q.answer ?? 0,
      explanation: q.explanation ?? "",
      must: lesson.quiz!.must_correct.includes(i),
    })) ?? [emptyQuestion()],
  );
  const [practiceDocs, setPracticeDocs] = useState<DocRef[]>(lesson?.practice_documents ?? []);
  const [doc, setDoc] = useState<Pick<DocumentItem, "title" | "file_name"> | null>(lesson?.document ?? null);
  const [picking, setPicking] = useState<"video" | "practice" | null>(null);
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  const type = form.content_type;
  const standard = type === "standard";
  const lessonKind = form.lesson_kind;
  const usesBody = type === "text" || standard;
  const usesUrl = type === "video" || type === "link" || standard;
  const usesDoc = type === "video" || type === "document" || standard;
  const videoLike = type === "video" || standard;

  /** Câu hỏi đã bỏ phương án trống, đáp án đổi vị trí theo (answer = -1: đáp án đúng đang để trống). */
  const cleanQuestions = () =>
    questions.map((q) => {
      const kept = q.options.map((o, i) => ({ o: o.trim(), i })).filter((x) => x.o);
      return {
        question: q.question.trim(),
        options: kept.map((x) => x.o),
        answer: kept.findIndex((x) => x.i === q.answer),
        explanation: q.explanation.trim() || null,
      };
    });

  const save = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = {
        title: form.title.trim(),
        content_type: type,
        // Gửi null cho trường không dùng để không còn dữ liệu cũ khi đổi loại bài
        body: usesBody ? form.body : form.body.trim() || null,
        external_url: usesUrl ? form.external_url.trim() || null : null,
        document_id: usesDoc ? form.document_id : null,
        duration_minutes: form.duration_minutes ? Number(form.duration_minutes) : null,
        is_required: form.is_required,
      };
      if (standard) {
        Object.assign(body, {
          lesson_kind: lessonKind,
          goals: lines(form.goals),
          video_minutes: form.video_minutes ? Number(form.video_minutes) : null,
          quiz:
            lessonKind === "quiz"
              ? {
                  pass_score: form.pass_all || !form.pass_score ? null : Number(form.pass_score),
                  must_correct: form.pass_all ? [] : questions.flatMap((q, i) => (q.must ? [i] : [])),
                  questions: cleanQuestions(),
                }
              : null,
          assignment:
            lessonKind === "practice"
              ? { requirement: form.requirement.trim(), criteria: lines(form.criteria), allow_text: form.allow_text }
              : null,
          practice_document_ids: practiceDocs.map((d) => d.id),
        });
      }
      if (lesson) return api.patch(`/courses/${courseId}/lessons/${lesson.id}`, body);
      return api.post(`/courses/${courseId}/lessons`, body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["courses", courseId] });
      qc.invalidateQueries({ queryKey: ["lessons"] });
      qc.invalidateQueries({ queryKey: ["enrollments"] });
      toast.success(lesson ? "Đã lưu bài học" : "Đã thêm bài học");
      onClose();
    },
    onError: toast.error,
  });

  // Điều kiện lưu, kèm lý do để hiện cho người soạn
  const problems: string[] = [];
  if (!form.title.trim()) problems.push("Nhập tên bài học");
  if (type === "text" && !form.body.trim()) problems.push("Nhập nội dung bài đọc");
  if (type === "document" && !form.document_id) problems.push("Chọn tài liệu");
  if (type === "link" && !form.external_url.trim()) problems.push("Nhập link");
  if (type === "video" && !form.document_id && !form.external_url.trim())
    problems.push("Chọn file video hoặc nhập link");
  if (standard) {
    if (!form.body.trim() && !lines(form.goals).length && !form.document_id && !form.external_url.trim()) {
      problems.push("Bài cần ít nhất mục tiêu, video hoặc nội dung");
    }
    if (lessonKind === "quiz") {
      const qs = cleanQuestions();
      if (qs.some((q) => !q.question || q.options.length < 2 || q.answer < 0)) {
        problems.push("Mỗi câu hỏi cần nội dung, ít nhất 2 phương án và đáp án đúng là phương án đã nhập");
      }
      if (!form.pass_all && form.pass_score && Number(form.pass_score) > qs.length) {
        problems.push("Số câu cần đạt lớn hơn số câu hỏi");
      }
    }
    if (lessonKind === "practice" && !form.requirement.trim()) problems.push("Nhập yêu cầu bài nộp");
  }

  const videoFields = (
    <>
      {usesDoc && (
        <Field
          label={videoLike ? "File video trong thư viện" : "Tài liệu"}
          required={type === "document"}
          className="sm:col-span-2"
        >
          {() => (
            <div className="flex items-center gap-2 rounded-lg border border-line-strong px-3 py-2">
              <FileText className="size-4 shrink-0 text-ink-3" />
              <span className="min-w-0 flex-1 truncate">
                {form.document_id && doc ? (
                  <>
                    <span className="font-medium">{doc.title}</span>
                    <span className="ml-2 text-xs text-ink-3">{doc.file_name}</span>
                  </>
                ) : form.document_id ? (
                  `Tài liệu #${form.document_id}`
                ) : (
                  <span className="text-ink-3">Chưa chọn</span>
                )}
              </span>
              {form.document_id && (
                <Button size="sm" variant="ghost" onClick={() => set("document_id", null)}>
                  Bỏ
                </Button>
              )}
              <Button size="sm" onClick={() => setPicking("video")}>
                Chọn / tải lên
              </Button>
            </div>
          )}
        </Field>
      )}
      {usesUrl && (
        <Field
          label={videoLike ? "Hoặc link video (YouTube, Vimeo, Google Drive)" : "Link"}
          required={type === "link"}
          className={standard ? undefined : "sm:col-span-2"}
          hint={videoLike && form.document_id ? "Đã chọn file: ưu tiên phát file trong thư viện" : undefined}
        >
          {(id) => (
            <Input
              id={id}
              type="url"
              placeholder="https://"
              value={form.external_url}
              onChange={(e) => set("external_url", e.target.value)}
            />
          )}
        </Field>
      )}
      {standard && (
        <Field
          label="Thời lượng video (phút)"
          hint="Video nhúng: học viên cần mở đủ 90% thời lượng mới tính là đã xem. File video: phải xem hết, không tua qua phần chưa xem."
        >
          {(id) => (
            <Input
              id={id}
              type="number"
              min={0}
              value={form.video_minutes}
              onChange={(e) => set("video_minutes", e.target.value)}
            />
          )}
        </Field>
      )}
      {standard && !form.document_id && !form.external_url.trim() && (
        <p className="text-xs text-ink-3 sm:col-span-2">
          Chưa có video: học viên thấy khung &quot;Video đang được cập nhật&quot; và vẫn học được từ nội dung.
        </p>
      )}
    </>
  );

  return (
    <>
      <Modal
        open
        size="xl"
        onClose={onClose}
        title={lesson ? `Sửa bài: ${lesson.title}` : "Thêm bài học"}
        footer={
          <>
            {problems.length > 0 && <p className="mr-auto text-xs text-ink-3">{problems[0]}</p>}
            <Button onClick={onClose}>Huỷ</Button>
            <Button
              variant="primary"
              loading={save.isPending}
              disabled={problems.length > 0}
              onClick={() => save.mutate()}
            >
              Lưu
            </Button>
          </>
        }
      >
        <div className="grid gap-4 sm:grid-cols-[1fr_200px]">
          <Field label="Tên bài học" required>
            {(id) => (
              <Input
                id={id}
                placeholder="VD: B1.1 · AI tạo sinh làm được gì, không làm được gì"
                value={form.title}
                onChange={(e) => set("title", e.target.value)}
              />
            )}
          </Field>
          <Field label="Loại bài" required>
            {(id) => (
              <Select id={id} value={type} onChange={(e) => set("content_type", e.target.value as LessonType)}>
                {TYPE_ORDER.map((t) => (
                  <option key={t} value={t}>
                    {LESSON_TYPE[t].label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <p className="-mt-2 text-xs text-ink-3 sm:col-span-2">{HINTS[type]}</p>

          {standard && (
            <div className="sm:col-span-2">
              <p className="mb-1.5 text-[13px] font-medium text-ink-2">
                Dạng bài<span className="ml-0.5 text-danger">*</span>
              </p>
              <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Dạng bài">
                {KIND_ORDER.map((k) => (
                  <button
                    key={k}
                    type="button"
                    role="radio"
                    aria-checked={lessonKind === k}
                    onClick={() => set("lesson_kind", k)}
                    className={cn(
                      "rounded-lg border px-3 py-2 text-left transition-colors",
                      lessonKind === k
                        ? "border-brand bg-brand-soft ring-1 ring-brand"
                        : "border-line-strong hover:bg-subtle",
                    )}
                  >
                    <span className="block text-sm font-medium">{LESSON_KIND[k].label}</span>
                    <span className="block text-xs text-ink-3">{LESSON_KIND[k].description}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="grid gap-4 sm:col-span-2 sm:grid-cols-3">
            <Field label="Thời lượng bài (phút)">
              {(id) => (
                <Input
                  id={id}
                  type="number"
                  min={0}
                  value={form.duration_minutes}
                  onChange={(e) => set("duration_minutes", e.target.value)}
                />
              )}
            </Field>
            <div className="flex items-end pb-2 sm:col-span-2">
              <Checkbox
                label="Bài bắt buộc (tính vào % hoàn thành)"
                checked={form.is_required}
                onChange={(e) => set("is_required", e.target.checked)}
              />
            </div>
          </div>

          {standard && (
            <Section title="🎯 Mục tiêu bài học">
              <Field label="Mỗi dòng một mục tiêu" className="sm:col-span-2">
                {(id) => (
                  <Textarea
                    id={id}
                    rows={3}
                    placeholder={
                      "Giải thích được vì sao AI có thể bịa số liệu\nPhân biệt việc nên / không nên giao cho AI"
                    }
                    value={form.goals}
                    onChange={(e) => set("goals", e.target.value)}
                  />
                )}
              </Field>
            </Section>
          )}

          {standard ? <Section title="🎬 Video của giảng viên">{videoFields}</Section> : videoFields}

          {standard ? (
            <Section title="📖 Nội dung">
              <HtmlEditor value={form.body} onChange={(v) => set("body", v)} />
            </Section>
          ) : (
            <Field
              label={usesBody ? "Nội dung bài đọc" : "Ghi chú cho học viên"}
              required={usesBody}
              className="sm:col-span-2"
            >
              {(id) => (
                <Textarea
                  id={id}
                  rows={usesBody ? 12 : 4}
                  value={form.body}
                  onChange={(e) => set("body", e.target.value)}
                />
              )}
            </Field>
          )}

          {standard && lessonKind === "quiz" && (
            <Section title="❓ Câu hỏi kiểm tra">
              <QuizEditor questions={questions} onChange={setQuestions} allowMust={!form.pass_all} />
              <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
                <span className="text-[13px] font-medium text-ink-2">Điều kiện đạt:</span>
                <Checkbox
                  label="Đúng tất cả các câu"
                  checked={form.pass_all}
                  onChange={(e) => set("pass_all", e.target.checked)}
                />
                {!form.pass_all && (
                  <span className="inline-flex items-center gap-2 text-sm">
                    Đúng tối thiểu
                    <Input
                      aria-label="Số câu đúng tối thiểu"
                      type="number"
                      min={1}
                      max={questions.length}
                      className="w-20"
                      value={form.pass_score}
                      onChange={(e) => set("pass_score", e.target.value)}
                    />
                    / {questions.length} câu
                  </span>
                )}
              </div>
            </Section>
          )}

          {standard && (
            <Section title="📎 Tài liệu thực hành">
              <div className="sm:col-span-2">
                {practiceDocs.length > 0 && (
                  <ul className="mb-2 divide-y divide-line rounded-lg border border-line">
                    {practiceDocs.map((d) => (
                      <li key={d.id} className="flex items-center gap-2 px-3 py-2">
                        <FileText className="size-4 shrink-0 text-ink-3" />
                        <span className="min-w-0 flex-1 truncate">
                          <span className="font-medium">{d.title}</span>
                          <span className="ml-2 text-xs text-ink-3">{d.file_name}</span>
                        </span>
                        <IconButton
                          label="Bỏ tài liệu"
                          onClick={() => setPracticeDocs((list) => list.filter((x) => x.id !== d.id))}
                        >
                          <X className="size-4" />
                        </IconButton>
                      </li>
                    ))}
                  </ul>
                )}
                <Button size="sm" icon={<Plus className="size-4" />} onClick={() => setPicking("practice")}>
                  Chọn / tải tài liệu
                </Button>
                <p className="mt-1.5 text-xs text-ink-3">
                  File mẫu, dữ liệu bài tập, phiếu chấm… Học viên của khoá học xem / tải về được kể cả khi tài liệu đặt
                  &quot;Theo khoá học&quot;.
                </p>
              </div>
            </Section>
          )}

          {standard && lessonKind === "practice" && (
            <Section title="📤 Nộp bài">
              <Field label="Bài nộp cần có" required className="sm:col-span-2">
                {(id) => (
                  <Textarea
                    id={id}
                    rows={2}
                    placeholder="VD: File báo giá (.docx), file Excel đối chiếu, email gửi kèm"
                    value={form.requirement}
                    onChange={(e) => set("requirement", e.target.value)}
                  />
                )}
              </Field>
              <Field label="Tiêu chí đạt (mỗi dòng một tiêu chí)" className="sm:col-span-2">
                {(id) => (
                  <Textarea
                    id={id}
                    rows={3}
                    placeholder={"Số tiền khớp 100% với bảng Excel\nKhông tự ý giảm giá vượt thẩm quyền"}
                    value={form.criteria}
                    onChange={(e) => set("criteria", e.target.value)}
                  />
                )}
              </Field>
              <Checkbox
                className="sm:col-span-2"
                label="Cho phép nộp bằng nội dung gõ vào ô ghi chú (không cần link / file)"
                checked={form.allow_text}
                onChange={(e) => set("allow_text", e.target.checked)}
              />
            </Section>
          )}

          {standard && (
            <p className="rounded-lg bg-subtle/70 px-3 py-2 text-xs text-ink-2 sm:col-span-2">
              <b>Điều kiện hoàn thành ({LESSON_KIND[lessonKind].label}):</b> {LESSON_KIND[lessonKind].done}.
            </p>
          )}
        </div>
      </Modal>
      {picking === "video" && (
        <DocumentPickerModal
          title={videoLike ? "Chọn file video" : "Chọn tài liệu"}
          initial={form.document_id ? [form.document_id] : []}
          onClose={() => setPicking(null)}
          onConfirm={(ids, docs) => {
            set("document_id", ids[0] ?? null);
            setDoc(docs[0] ?? null);
            setPicking(null);
          }}
        />
      )}
      {picking === "practice" && (
        <DocumentPickerModal
          title="Chọn tài liệu thực hành"
          multiple
          initial={practiceDocs.map((d) => d.id)}
          onClose={() => setPicking(null)}
          onConfirm={(ids, docs) => {
            const known = new Map([...practiceDocs, ...docs].map((d) => [d.id, d]));
            setPracticeDocs(ids.map((id) => known.get(id) ?? { id, title: `Tài liệu #${id}`, file_name: "" }));
            setPicking(null);
          }}
        />
      )}
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="grid gap-3 border-t border-line pt-4 sm:col-span-2 sm:grid-cols-2">
      <legend className="pr-2 text-sm font-semibold text-ink">{title}</legend>
      {children}
    </fieldset>
  );
}

// Khối soạn sẵn chèn vào nội dung (cùng class với mẫu, xem .lesson-html trong globals.css)
const SNIPPETS: { label: string; html: string }[] = [
  { label: "Tiêu đề", html: "<h2>Tiêu đề mục</h2>\n" },
  { label: "Tiêu đề nhỏ", html: "<h3>Tiêu đề nhỏ</h3>\n" },
  { label: "Đoạn văn", html: "<p>Nội dung đoạn văn, <b>chữ đậm</b>.</p>\n" },
  { label: "Danh sách", html: "<ul>\n<li>Ý thứ nhất</li>\n<li>Ý thứ hai</li>\n</ul>\n" },
  { label: "Danh sách số", html: "<ol>\n<li>Bước 1</li>\n<li>Bước 2</li>\n</ol>\n" },
  {
    label: "Bảng",
    html: "<table>\n<tr><th>Cột 1</th><th>Cột 2</th></tr>\n<tr><td>...</td><td>...</td></tr>\n<tr><td>...</td><td>...</td></tr>\n</table>\n",
  },
  {
    label: "Câu lệnh mẫu",
    html: '<pre class="prompt">Vai trò: ...\nBối cảnh: ...\nNhiệm vụ: ...\nĐầu ra: ...\nTiêu chí: ...</pre>\n',
  },
  { label: "Lưu ý", html: '<div class="card warn"><b>Lưu ý:</b> ...</div>\n' },
  { label: "Ghi nhớ", html: '<div class="card rule"><b>Ghi nhớ:</b> ...</div>\n' },
  { label: "Chú thích nhỏ", html: '<p class="hint">Chú thích...</p>\n' },
  {
    label: "Đèn Đỏ/Vàng/Xanh",
    html: '<span class="light-pill lp-r">Đỏ</span> <span class="light-pill lp-y">Vàng</span> <span class="light-pill lp-g">Xanh</span>',
  },
];

/** Soạn nội dung HTML: chèn khối mẫu tại con trỏ, xem trước đúng như học viên thấy. */
function HtmlEditor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [preview, setPreview] = useState(false);

  const insert = (html: string) => {
    const ta = ref.current;
    const start = ta?.selectionStart ?? value.length;
    const end = ta?.selectionEnd ?? value.length;
    const before = value.slice(0, start);
    const pad = before && !before.endsWith("\n") ? "\n" : "";
    onChange(before + pad + html + value.slice(end));
    requestAnimationFrame(() => {
      if (!ta) return;
      ta.focus();
      const pos = start + pad.length + html.length;
      ta.setSelectionRange(pos, pos);
    });
  };

  return (
    <div className="sm:col-span-2">
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <div className="flex rounded-lg border border-line-strong p-0.5 text-[13px]">
          {(["Soạn", "Xem trước"] as const).map((t, i) => (
            <button
              key={t}
              type="button"
              aria-pressed={preview === (i === 1)}
              onClick={() => setPreview(i === 1)}
              className={cn("rounded-md px-2.5 py-1", preview === (i === 1) ? "bg-brand text-white" : "text-ink-2")}
            >
              {t}
            </button>
          ))}
        </div>
        {!preview &&
          SNIPPETS.map((s) => (
            <Button
              key={s.label}
              size="sm"
              variant="ghost"
              className="h-7 border border-line"
              onClick={() => insert(s.html)}
            >
              {s.label}
            </Button>
          ))}
      </div>
      {preview ? (
        <div className="min-h-48 rounded-lg border border-line p-4">
          {value.trim() ? <RichContent html={value} /> : <p className="text-ink-3">Chưa có nội dung</p>}
        </div>
      ) : (
        <Textarea
          ref={ref}
          aria-label="Nội dung bài học (HTML)"
          rows={14}
          className="font-mono text-[13px]"
          placeholder={
            "<h2>Ba điều cần nhớ</h2>\n<ol>\n<li>...</li>\n</ol>\n\nGõ văn bản thường cũng được: mỗi đoạn cách nhau một dòng trống."
          }
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      <p className="mt-1.5 text-xs text-ink-3">
        Dán HTML (như phần nội dung của file mẫu) hoặc dùng các nút chèn khối. Khối &quot;Câu lệnh mẫu&quot; có nút Sao
        chép cho học viên. Script, style và iframe bị loại bỏ khi hiển thị.
      </p>
    </div>
  );
}

function QuizEditor({
  questions,
  onChange,
  allowMust,
}: {
  questions: QuestionDraft[];
  onChange: (q: QuestionDraft[]) => void;
  allowMust: boolean;
}) {
  const update = (i: number, patch: Partial<QuestionDraft>) =>
    onChange(questions.map((q, j) => (j === i ? { ...q, ...patch } : q)));

  return (
    <div className="space-y-3 sm:col-span-2">
      {questions.map((q, i) => (
        <div key={i} className="rounded-lg border border-line p-3">
          <div className="mb-2 flex items-start gap-2">
            <span className="mt-2 w-6 shrink-0 text-sm font-semibold text-ink-3">{i + 1}.</span>
            <Textarea
              aria-label={`Câu hỏi ${i + 1}`}
              rows={2}
              placeholder="Nội dung câu hỏi / tình huống"
              value={q.question}
              onChange={(e) => update(i, { question: e.target.value })}
            />
            <IconButton
              label="Xoá câu hỏi"
              className="hover:text-danger"
              disabled={questions.length === 1}
              onClick={() => onChange(questions.filter((_, j) => j !== i))}
            >
              <Trash2 className="size-4" />
            </IconButton>
          </div>
          <div className="ml-8 space-y-1.5">
            {q.options.map((o, j) => (
              <div key={j} className="flex items-center gap-2">
                <input
                  type="radio"
                  name={`answer-${i}`}
                  aria-label={`Đáp án đúng: phương án ${j + 1}`}
                  title="Đáp án đúng"
                  className="size-4 accent-brand"
                  checked={q.answer === j}
                  onChange={() => update(i, { answer: j })}
                />
                <Input
                  aria-label={`Phương án ${j + 1}`}
                  placeholder={`Phương án ${j + 1}`}
                  className={cn("h-8", q.answer === j && "border-emerald-400")}
                  value={o}
                  onChange={(e) => update(i, { options: q.options.map((x, k) => (k === j ? e.target.value : x)) })}
                />
                <IconButton
                  label="Xoá phương án"
                  disabled={q.options.length <= 2}
                  onClick={() =>
                    update(i, {
                      options: q.options.filter((_, k) => k !== j),
                      answer: q.answer === j ? 0 : q.answer > j ? q.answer - 1 : q.answer,
                    })
                  }
                >
                  <X className="size-4" />
                </IconButton>
              </div>
            ))}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Button
                size="sm"
                variant="ghost"
                icon={<Plus className="size-4" />}
                disabled={q.options.length >= 10}
                onClick={() => update(i, { options: [...q.options, ""] })}
              >
                Thêm phương án
              </Button>
              <span className="text-xs text-ink-3">Chọn nút tròn cạnh đáp án đúng</span>
              {allowMust && (
                <Checkbox
                  className="ml-auto"
                  label="Bắt buộc trả lời đúng"
                  checked={q.must}
                  onChange={(e) => update(i, { must: e.target.checked })}
                />
              )}
            </div>
            <Input
              aria-label={`Giải thích câu ${i + 1}`}
              placeholder="Giải thích (hiện cho học viên sau khi chấm)"
              value={q.explanation}
              onChange={(e) => update(i, { explanation: e.target.value })}
            />
          </div>
        </div>
      ))}
      <Button size="sm" icon={<Plus className="size-4" />} onClick={() => onChange([...questions, emptyQuestion()])}>
        Thêm câu hỏi
      </Button>
    </div>
  );
}
