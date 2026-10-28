"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import axios, { AxiosError } from "axios";
import { Upload } from "lucide-react";
import { useRef, useState } from "react";

import { CategorySelect } from "@/components/category-select";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { ProgressBar } from "@/components/ui/misc";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/api";
import { VISIBILITY } from "@/lib/labels";
import type { DocumentDetail, DocumentVisibility } from "@/lib/types";
import { cn, fmtBytes } from "@/lib/utils";

// Khớp FILE_MAX_MB của backend
const MAX_MB = 2048;

// Bucket chưa bật CORS cho địa chỉ giao diện thì PUT thẳng bị trình duyệt chặn: tải qua API, chỉ cho file vừa phải
const API_FALLBACK_MAX = 100 * 1024 * 1024;

type UploadMeta = { title: string; description: string; category_id: number | null; visibility: DocumentVisibility };
type Progress = (pct: number) => void;

/** Cách chính: xin URL ký tạm, trình duyệt PUT file thẳng lên Cloudflare R2, rồi báo API tạo tài liệu. */
async function uploadDirect(file: File, meta: UploadMeta, onProgress: Progress, signal: AbortSignal) {
  const contentType = file.type || "application/octet-stream";
  const { data: ticket } = await api.post<{ upload_url: string; storage_key: string }>("/documents/upload-url", {
    file_name: file.name,
    size_bytes: file.size,
    content_type: contentType,
  });
  // axios gốc (không phải instance api): không gửi kèm token đăng nhập sang Cloudflare
  await axios.put(ticket.upload_url, file, {
    headers: { "Content-Type": contentType },
    signal,
    onUploadProgress: (e) => e.total && onProgress(Math.round((100 * e.loaded) / e.total)),
  });
  const { data } = await api.post<DocumentDetail>("/documents/complete", {
    storage_key: ticket.storage_key,
    file_name: file.name,
    content_type: contentType,
    title: meta.title.trim() || null,
    description: meta.description.trim() || null,
    category_id: meta.category_id,
    visibility: meta.visibility,
  });
  return data;
}

/** Dự phòng: gửi file qua API (multipart), API đẩy lên R2. */
async function uploadViaApi(file: File, meta: UploadMeta, onProgress: Progress, signal: AbortSignal) {
  const form = new FormData();
  form.append("file", file);
  if (meta.title.trim()) form.append("title", meta.title.trim());
  if (meta.description.trim()) form.append("description", meta.description.trim());
  if (meta.category_id) form.append("category_id", String(meta.category_id));
  form.append("visibility", meta.visibility);
  const { data } = await api.post<DocumentDetail>("/documents", form, {
    signal,
    onUploadProgress: (e) => e.total && onProgress(Math.round((100 * e.loaded) / e.total)),
  });
  return data;
}

/** PUT bị chặn trước khi tới R2 (CORS / mạng): không có response. */
const blockedByBrowser = (err: unknown) =>
  err instanceof AxiosError && !err.response && err.code !== "ERR_CANCELED" && !!err.config?.url?.startsWith("http");

/** Tải tài liệu / video lên thư viện (Cloudflare R2). */
export function UploadDocumentModal({
  defaultVisibility = "company",
  onClose,
  onUploaded,
}: {
  defaultVisibility?: DocumentVisibility;
  onClose: () => void;
  onUploaded?: (doc: DocumentDetail) => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState(0);
  const [phase, setPhase] = useState<"direct" | "api">("direct");
  const abortRef = useRef<AbortController | null>(null);
  const [form, setForm] = useState({
    title: "",
    description: "",
    category_id: null as number | null,
    visibility: defaultVisibility,
  });

  const upload = useMutation({
    mutationFn: async () => {
      const controller = new AbortController();
      abortRef.current = controller;
      setProgress(0);
      setPhase("direct");
      try {
        return await uploadDirect(file!, form, setProgress, controller.signal);
      } catch (err) {
        if (!blockedByBrowser(err)) throw err;
        if (file!.size > API_FALLBACK_MAX) {
          throw new Error(
            "Trình duyệt không tải thẳng lên Cloudflare R2 được (bucket chưa bật CORS cho địa chỉ này). " +
              "Nhờ quản trị cấu hình CORS cho bucket rồi thử lại.",
          );
        }
        setProgress(0);
        setPhase("api");
        return uploadViaApi(file!, form, setProgress, controller.signal);
      }
    },
    onSuccess: (doc) => {
      qc.invalidateQueries({ queryKey: ["documents"] });
      toast.success(`Đã tải lên "${doc.title}"`);
      onUploaded?.(doc);
      onClose();
    },
    onError: (err) => {
      setProgress(0);
      if (err instanceof AxiosError && err.code === "ERR_CANCELED") return;
      toast.error(err);
    },
  });

  const close = () => {
    abortRef.current?.abort();
    onClose();
  };
  const tooBig = file && file.size > MAX_MB * 1024 * 1024;

  return (
    <Modal
      open
      onClose={close}
      title="Tải tài liệu lên"
      description="PDF, Word, Excel, PowerPoint, ảnh, video, âm thanh…"
      footer={
        <>
          <Button onClick={close}>Huỷ</Button>
          <Button variant="primary" loading={upload.isPending} disabled={!file || !!tooBig} onClick={() => upload.mutate()}>
            {upload.isPending ? `Đang tải ${progress}%` : "Tải lên"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            if (e.dataTransfer.files[0]) setFile(e.dataTransfer.files[0]);
          }}
          className={cn(
            "flex w-full flex-col items-center gap-2 rounded-lg border-2 border-dashed px-4 py-8 text-center transition-colors",
            dragging ? "border-brand bg-brand-soft" : "border-line-strong hover:bg-subtle",
          )}
        >
          <Upload className="size-6 text-ink-3" />
          {file ? (
            <span>
              <span className="font-medium">{file.name}</span>
              <span className={cn("ml-2", tooBig ? "font-medium text-danger" : "text-ink-3")}>
                {fmtBytes(file.size)}
                {tooBig && ` — vượt quá ${MAX_MB / 1024} GB`}
              </span>
            </span>
          ) : (
            <span className="text-ink-2">Kéo thả file vào đây hoặc bấm để chọn</span>
          )}
          <span className="text-xs text-ink-3">Video, tài liệu tối đa {MAX_MB / 1024} GB · lưu trên Cloudflare R2</span>
        </button>
        {upload.isPending && (
          <div className="space-y-1">
            <ProgressBar value={progress} />
            <p className="text-xs text-ink-3">
              {phase === "direct" ? "Đang tải thẳng lên Cloudflare R2…" : "Đang tải qua máy chủ (bucket chưa bật CORS)…"}
            </p>
          </div>
        )}
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && setFile(e.target.files[0])}
        />
        <Field label="Tiêu đề" hint="Bỏ trống = tên file">
          {(id) => <Input id={id} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />}
        </Field>
        <Field label="Mô tả">
          {(id) => (
            <Textarea id={id} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          )}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Danh mục">
            {(id) => (
              <CategorySelect id={id} value={form.category_id} onChange={(v) => setForm({ ...form, category_id: v })} />
            )}
          </Field>
          <Field label="Phạm vi" hint={VISIBILITY[form.visibility].description}>
            {(id) => (
              <Select
                id={id}
                value={form.visibility}
                onChange={(e) => setForm({ ...form, visibility: e.target.value as DocumentVisibility })}
              >
                {(Object.keys(VISIBILITY) as DocumentVisibility[]).map((v) => (
                  <option key={v} value={v}>
                    {VISIBILITY[v].label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
      </div>
    </Modal>
  );
}
