"use client";

import { useQuery } from "@tanstack/react-query";
import { FileText, Search, Upload } from "lucide-react";
import { useDeferredValue, useState } from "react";

import { UploadDocumentModal } from "@/components/document/upload-modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form";
import { Spinner } from "@/components/ui/misc";
import { Modal } from "@/components/ui/modal";
import { api, clean } from "@/lib/api";
import type { DocumentItem, Page } from "@/lib/types";
import { cn, fmtBytes } from "@/lib/utils";

/** Danh sách tài liệu có tìm kiếm, chọn một hoặc nhiều; có nút tải tài liệu mới lên. */
export function DocumentPickerModal({
  title,
  multiple,
  initial = [],
  onClose,
  onConfirm,
}: {
  title: string;
  multiple?: boolean;
  initial?: number[];
  onClose: () => void;
  onConfirm: (ids: number[], docs: DocumentItem[]) => void;
}) {
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<number[]>(initial);
  const [uploading, setUploading] = useState(false);
  const [known, setKnown] = useState<Map<number, DocumentItem>>(new Map());
  const search = useDeferredValue(q);
  const query = useQuery({
    queryKey: ["documents", "picker", search],
    queryFn: async () => (await api.get<Page<DocumentItem>>("/documents", { params: clean({ q: search, size: 100 }) })).data,
  });
  const docs = query.data?.items ?? [];
  const lookup = new Map([...known, ...docs.map((d) => [d.id, d] as const)]);

  const toggle = (id: number) =>
    setSelected((s) => (multiple ? (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]) : [id]));

  return (
    <>
      <Modal
        open
        size="lg"
        onClose={onClose}
        title={title}
        footer={
          <>
            <Button icon={<Upload className="size-4" />} className="mr-auto" onClick={() => setUploading(true)}>
              Tải tài liệu mới
            </Button>
            <Button onClick={onClose}>Huỷ</Button>
            <Button
              variant="primary"
              disabled={!multiple && !selected.length}
              onClick={() =>
                onConfirm(selected, selected.map((id) => lookup.get(id)).filter((d): d is DocumentItem => !!d))
              }
            >
              {multiple ? `Lưu (${selected.length})` : "Chọn"}
            </Button>
          </>
        }
      >
        <div className="relative mb-3">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3" />
          <Input aria-label="Tìm tài liệu" placeholder="Tìm theo tiêu đề, tên file" className="pl-9" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {query.isPending ? (
          <Spinner />
        ) : !docs.length ? (
          <p className="py-8 text-center text-ink-3">Chưa có tài liệu — tải tài liệu mới lên</p>
        ) : (
          <ul className="max-h-[50vh] divide-y divide-line overflow-y-auto rounded-lg border border-line">
            {docs.map((d) => {
              const checked = selected.includes(d.id);
              return (
                <li key={d.id}>
                  <label className={cn("flex cursor-pointer items-center gap-3 px-3 py-2.5 hover:bg-subtle", checked && "bg-brand-soft/60")}>
                    <input
                      type={multiple ? "checkbox" : "radio"}
                      name="document"
                      className="size-4 accent-brand"
                      checked={checked}
                      onChange={() => toggle(d.id)}
                    />
                    <FileText className="size-4 shrink-0 text-ink-3" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{d.title}</span>
                      <span className="block truncate text-xs text-ink-3">
                        {d.file_name} · {fmtBytes(d.size_bytes)}
                      </span>
                    </span>
                    {multiple && checked && (
                      <span className="text-xs text-ink-3 tabular-nums">#{selected.indexOf(d.id) + 1}</span>
                    )}
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </Modal>
      {uploading && (
        <UploadDocumentModal
          defaultVisibility="course"
          onClose={() => setUploading(false)}
          onUploaded={(doc) => {
            setKnown((m) => new Map(m).set(doc.id, doc));
            toggle(doc.id);
          }}
        />
      )}
    </>
  );
}
