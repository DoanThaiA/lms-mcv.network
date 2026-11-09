"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, FileUp, Film, Paperclip, XCircle } from "lucide-react";
import { useState } from "react";

import { MetaBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/form";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/api";
import { buildImportRows, extractTemplate, type ImportRow } from "@/lib/import-template";
import { LESSON_KIND } from "@/lib/labels";
import type { CourseDetail, DocumentItem, Page } from "@/lib/types";
import { cn } from "@/lib/utils";

const MAX_BULK = 200; // khớp LessonBulkCreate (backend)

async function libraryByFileName(): Promise<Map<string, DocumentItem>> {
  const map = new Map<string, DocumentItem>();
  for (let page = 1; page <= 50; page++) {
    const { data } = await api.get<Page<DocumentItem>>("/documents", { params: { page, size: 100 } });
    for (const d of data.items) if (!map.has(d.file_name.toLowerCase())) map.set(d.file_name.toLowerCase(), d);
    if (page * data.size >= data.total) break;
  }
  return map;
}

/** Nhập bài học từ file khoá học HTML theo mẫu (LESSONS / PARTS / RESOURCES) vào cuối khoá học. */
export function ImportLessonsModal({ course, onClose }: { course: CourseDetail; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<ImportRow[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reading, setReading] = useState(false);
  const [error, setError] = useState("");

  const existing = new Set(course.lessons.map((l) => l.title.trim().toLowerCase()));
  const isDuplicate = (r: ImportRow) => !!r.payload && existing.has(r.payload.title.toLowerCase());

  const read = async (file: File) => {
    setFileName(file.name);
    setRows(null);
    setError("");
    setReading(true);
    try {
      const [data, docs] = await Promise.all([extractTemplate(await file.text()), libraryByFileName()]);
      const built = buildImportRows(data, docs);
      setRows(built);
      // Mặc định chọn mọi bài hợp lệ, trừ bài đã có cùng tên trong khoá học
      setSelected(new Set(built.filter((r) => r.payload && !isDuplicate(r)).map((r) => r.key)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không đọc được file");
    } finally {
      setReading(false);
    }
  };

  const chosen = (rows ?? []).filter((r) => r.payload && selected.has(r.key));
  const save = useMutation({
    mutationFn: () => api.post(`/courses/${course.id}/lessons/bulk`, { lessons: chosen.map((r) => r.payload) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["courses", course.id] });
      qc.invalidateQueries({ queryKey: ["enrollments"] });
      toast.success(`Đã nhập ${chosen.length} bài học`);
      onClose();
    },
    onError: toast.error,
  });

  const missingFiles = [
    ...new Map(
      (rows ?? []).flatMap((r) => r.files.filter((f) => !f.document && !f.url).map((f) => [f.name, f] as const)),
    ).values(),
  ];
  const toggle = (key: string, on: boolean) =>
    setSelected((s) => {
      const next = new Set(s);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });

  return (
    <Modal
      open
      size="xl"
      onClose={onClose}
      title="Nhập bài học từ file HTML"
      description={`Thêm vào cuối khoá ${course.code} · ${course.title}`}
      footer={
        <>
          {rows && (
            <p className="mr-auto text-xs text-ink-3">
              Đã chọn {chosen.length}/{rows.length} bài
              {chosen.length > MAX_BULK ? ` — tối đa ${MAX_BULK} bài mỗi lần` : ""}
            </p>
          )}
          <Button onClick={onClose}>Huỷ</Button>
          <Button
            variant="primary"
            loading={save.isPending}
            disabled={!chosen.length || chosen.length > MAX_BULK}
            onClick={() => save.mutate()}
          >
            Nhập {chosen.length || ""} bài
          </Button>
        </>
      }
    >
      <label
        className={cn(
          "flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed border-line-strong px-4 py-6 text-center hover:bg-subtle",
          reading && "pointer-events-none opacity-60",
        )}
      >
        <FileUp className="size-6 text-ink-3" />
        <span className="font-medium">{reading ? "Đang đọc file…" : fileName || "Chọn file khoá học (.html)"}</span>
        <span className="max-w-xl text-xs text-ink-3">
          File theo mẫu &quot;AI thực chiến&quot; (có LESSONS, PARTS, RESOURCES). Mỗi bài thành một &quot;Bài học
          chuẩn&quot;: mục tiêu, video, nội dung, câu hỏi kiểm tra, yêu cầu nộp bài. Tài liệu thực hành được gắn tự động
          nếu thư viện đã có file cùng tên. Script của file chạy trong khung cách ly, không truy cập được tài khoản LMS.
        </span>
        <input
          type="file"
          accept=".html,.htm,text/html"
          className="sr-only"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) read(f);
            e.target.value = "";
          }}
        />
      </label>

      {error && (
        <p className="mt-3 rounded-lg bg-danger-soft px-3 py-2 text-[13px] text-danger ring-1 ring-red-200">{error}</p>
      )}

      {missingFiles.length > 0 && (
        <div className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-[13px] text-amber-900 ring-1 ring-amber-200">
          <p className="font-medium">{missingFiles.length} tài liệu thực hành chưa có trong thư viện:</p>
          <p className="mt-0.5">{missingFiles.map((f) => f.name).join(" · ")}</p>
          <p className="mt-1 text-xs">
            Tải các file này lên Thư viện tài liệu (giữ đúng tên file) rồi chọn lại file HTML để tự gắn vào bài; hoặc
            nhập trước rồi gắn sau khi sửa bài.
          </p>
        </div>
      )}

      {rows && (
        <>
          <div className="mt-4 mb-2 flex flex-wrap items-center gap-3 text-[13px]">
            <Checkbox
              label="Chọn tất cả bài hợp lệ"
              checked={chosen.length > 0 && chosen.length === rows.filter((r) => r.payload).length}
              onChange={(e) =>
                setSelected(new Set(e.target.checked ? rows.filter((r) => r.payload).map((r) => r.key) : []))
              }
            />
            <span className="text-ink-3">
              {rows.filter((r) => r.payload).length} hợp lệ · {rows.filter((r) => !r.payload).length} lỗi ·{" "}
              {rows.filter(isDuplicate).length} trùng tên bài đã có
            </span>
          </div>
          <ul className="max-h-[52vh] divide-y divide-line overflow-y-auto rounded-lg border border-line">
            {rows.map((r, i) => {
              const p = r.payload;
              const header = r.partTitle && r.partTitle !== rows[i - 1]?.partTitle ? r.partTitle : "";
              return (
                <li key={r.key}>
                  {header && (
                    <p className="bg-subtle px-3 py-1.5 text-xs font-semibold tracking-wide text-ink-2 uppercase">
                      {header}
                    </p>
                  )}
                  <label className={cn("flex gap-3 px-3 py-2", p ? "cursor-pointer hover:bg-subtle/60" : "opacity-80")}>
                    <input
                      type="checkbox"
                      className="mt-1 size-4 shrink-0 accent-brand"
                      disabled={!p}
                      checked={!!p && selected.has(r.key)}
                      onChange={(e) => toggle(r.key, e.target.checked)}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">{p?.title ?? (r.code || "Bài không tên")}</span>
                      {p && (
                        <span className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-3">
                          <MetaBadge meta={LESSON_KIND[p.lesson_kind]} dot={false} />
                          {p.duration_minutes ? <span>{p.duration_minutes} phút</span> : null}
                          <span className="inline-flex items-center gap-1">
                            <Film className="size-3.5" />
                            {p.external_url ? `Video${p.video_minutes ? ` ${p.video_minutes}'` : ""}` : "Chưa có video"}
                          </span>
                          {p.quiz && (
                            <span>
                              {p.quiz.questions.length} câu hỏi ·{" "}
                              {p.quiz.pass_score ? `đạt ≥ ${p.quiz.pass_score}` : "đúng tất cả"}
                              {p.quiz.must_correct.length
                                ? ` · bắt buộc đúng câu ${p.quiz.must_correct.map((i) => i + 1).join(", ")}`
                                : ""}
                            </span>
                          )}
                          {p.assignment && <span>Nộp bài · {p.assignment.criteria.length} tiêu chí</span>}
                          {r.files.length > 0 && (
                            <span className="inline-flex items-center gap-1">
                              <Paperclip className="size-3.5" />
                              {r.files.filter((f) => f.document).length}/{r.files.length} tài liệu
                            </span>
                          )}
                        </span>
                      )}
                      {isDuplicate(r) && (
                        <span className="mt-1 flex items-center gap-1 text-xs text-amber-700">
                          <AlertTriangle className="size-3.5" /> Khoá học đã có bài cùng tên
                        </span>
                      )}
                      {r.warnings.map((w) => (
                        <span key={w} className="mt-1 flex items-start gap-1 text-xs text-amber-700">
                          <AlertTriangle className="mt-px size-3.5 shrink-0" /> {w}
                        </span>
                      ))}
                      {r.errors.map((w) => (
                        <span key={w} className="mt-1 flex items-start gap-1 text-xs text-danger">
                          <XCircle className="mt-px size-3.5 shrink-0" /> {w}
                        </span>
                      ))}
                    </span>
                    {p && !r.warnings.length && !isDuplicate(r) && (
                      <CheckCircle2 className="mt-1 size-4 shrink-0 text-emerald-600" />
                    )}
                  </label>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </Modal>
  );
}
