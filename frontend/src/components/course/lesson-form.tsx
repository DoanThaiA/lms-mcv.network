"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText } from "lucide-react";
import { useState } from "react";

import { DocumentPickerModal } from "@/components/document/document-picker";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/form";
import { Modal } from "@/components/ui/modal";
import { Spinner } from "@/components/ui/misc";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/api";
import { LESSON_TYPE } from "@/lib/labels";
import type { DocumentItem, LessonDetail, LessonType } from "@/lib/types";

const HINTS: Record<LessonType, string> = {
  text: "Nội dung bài đọc gõ trực tiếp",
  video: "File video trong thư viện, hoặc link YouTube / Vimeo / trang khác",
  document: "Tài liệu trong thư viện (PDF, Word, PowerPoint…) xem ngay trên trình duyệt",
  link: "Trang web bên ngoài, học viên mở ở tab mới",
};

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
    content_type: lesson?.content_type ?? ("text" as LessonType),
    body: lesson?.body ?? "",
    external_url: lesson?.external_url ?? "",
    document_id: lesson?.document_id ?? null,
    duration_minutes: lesson?.duration_minutes?.toString() ?? "",
    is_required: lesson?.is_required ?? true,
  });
  const [doc, setDoc] = useState<Pick<DocumentItem, "title" | "file_name"> | null>(lesson?.document ?? null);
  const [picking, setPicking] = useState(false);
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  const kind = form.content_type;
  const usesBody = kind === "text";
  const usesUrl = kind === "video" || kind === "link";
  const usesDoc = kind === "video" || kind === "document";

  const save = useMutation({
    mutationFn: async () => {
      const body = {
        title: form.title.trim(),
        content_type: kind,
        // Gửi null cho trường không dùng để không còn dữ liệu cũ khi đổi loại bài
        body: usesBody ? form.body : form.body.trim() || null,
        external_url: usesUrl ? form.external_url.trim() || null : null,
        document_id: usesDoc ? form.document_id : null,
        duration_minutes: form.duration_minutes ? Number(form.duration_minutes) : null,
        is_required: form.is_required,
      };
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

  const valid =
    form.title.trim() &&
    (kind !== "text" || form.body.trim()) &&
    (kind !== "document" || form.document_id) &&
    (kind !== "link" || form.external_url.trim()) &&
    (kind !== "video" || form.document_id || form.external_url.trim());

  return (
    <>
      <Modal
        open
        size="lg"
        onClose={onClose}
        title={lesson ? `Sửa bài: ${lesson.title}` : "Thêm bài học"}
        footer={
          <>
            <Button onClick={onClose}>Huỷ</Button>
            <Button variant="primary" loading={save.isPending} disabled={!valid} onClick={() => save.mutate()}>
              Lưu
            </Button>
          </>
        }
      >
        <div className="grid gap-4 sm:grid-cols-[1fr_180px]">
          <Field label="Tên bài học" required>
            {(id) => <Input id={id} value={form.title} onChange={(e) => set("title", e.target.value)} />}
          </Field>
          <Field label="Loại bài" required>
            {(id) => (
              <Select id={id} value={kind} onChange={(e) => set("content_type", e.target.value as LessonType)}>
                {(Object.keys(LESSON_TYPE) as LessonType[]).map((t) => (
                  <option key={t} value={t}>
                    {LESSON_TYPE[t].label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <p className="-mt-2 text-xs text-ink-3 sm:col-span-2">{HINTS[kind]}</p>

          {usesDoc && (
            <Field label={kind === "video" ? "File video trong thư viện" : "Tài liệu"} required={kind === "document"} className="sm:col-span-2">
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
                  <Button size="sm" onClick={() => setPicking(true)}>
                    Chọn / tải lên
                  </Button>
                </div>
              )}
            </Field>
          )}
          {usesUrl && (
            <Field
              label={kind === "video" ? "Hoặc link video" : "Link"}
              required={kind === "link"}
              className="sm:col-span-2"
              hint={kind === "video" && form.document_id ? "Đã chọn file: ưu tiên phát file trong thư viện" : undefined}
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
          <Field label="Thời lượng (phút)">
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
          <div className="flex items-end pb-2">
            <Checkbox
              label="Bài bắt buộc (tính vào % hoàn thành)"
              checked={form.is_required}
              onChange={(e) => set("is_required", e.target.checked)}
            />
          </div>
        </div>
      </Modal>
      {picking && (
        <DocumentPickerModal
          title={kind === "video" ? "Chọn file video" : "Chọn tài liệu"}
          initial={form.document_id ? [form.document_id] : []}
          onClose={() => setPicking(false)}
          onConfirm={(ids, docs) => {
            set("document_id", ids[0] ?? null);
            setDoc(docs[0] ?? null);
            setPicking(false);
          }}
        />
      )}
    </>
  );
}
