"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Film, Image as ImageIcon, Music, Pencil, Search, Trash2, Upload } from "lucide-react";
import { useDeferredValue, useState } from "react";

import { CategorySelect } from "@/components/category-select";
import { DocumentOpenButtons } from "@/components/document/document-row-actions";
import { UploadDocumentModal } from "@/components/document/upload-modal";
import { MetaBadge } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Card, Empty, PageHeader, Pagination, Spinner, Table } from "@/components/ui/misc";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { api, clean } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useCategories } from "@/lib/hooks";
import { VISIBILITY } from "@/lib/labels";
import type { DocumentItem, DocumentVisibility, Page } from "@/lib/types";
import { fmtBytes, fmtDate } from "@/lib/utils";

const SIZE = 30;

function FileIcon({ name }: { name: string }) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const cls = "size-4 shrink-0 text-ink-3";
  if (["mp4", "webm", "mov", "m4v"].includes(ext)) return <Film className={cls} />;
  if (["png", "jpg", "jpeg", "gif", "webp"].includes(ext)) return <ImageIcon className={cls} />;
  if (["mp3", "wav", "m4a", "ogg"].includes(ext)) return <Music className={cls} />;
  return <FileText className={cls} />;
}

function EditDocumentModal({ doc, onClose }: { doc: DocumentItem; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState({
    title: doc.title,
    description: doc.description ?? "",
    category_id: doc.category_id,
    visibility: doc.visibility,
  });
  const save = useMutation({
    mutationFn: () =>
      api.patch(`/documents/${doc.id}`, { ...form, title: form.title.trim(), description: form.description.trim() || null }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["documents"] });
      toast.success("Đã lưu tài liệu");
      onClose();
    },
    onError: toast.error,
  });
  return (
    <Modal
      open
      onClose={onClose}
      title="Sửa tài liệu"
      description={doc.file_name}
      footer={
        <>
          <Button onClick={onClose}>Huỷ</Button>
          <Button variant="primary" loading={save.isPending} disabled={!form.title.trim()} onClick={() => save.mutate()}>
            Lưu
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Tiêu đề" required>
          {(id) => <Input id={id} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />}
        </Field>
        <Field label="Mô tả">
          {(id) => <Textarea id={id} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Danh mục">
            {(id) => <CategorySelect id={id} value={form.category_id} onChange={(v) => setForm({ ...form, category_id: v })} />}
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

export default function DocumentsPage() {
  const { can } = useAuth();
  const manage = can("content.manage");
  const qc = useQueryClient();
  const toast = useToast();
  const { byId: categoryById } = useCategories();
  const [q, setQ] = useState("");
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [visibility, setVisibility] = useState<DocumentVisibility | "">("");
  const [page, setPage] = useState(1);
  const [uploading, setUploading] = useState(false);
  const [editing, setEditing] = useState<DocumentItem | null>(null);
  const search = useDeferredValue(q);

  const params = clean({ q: search, category_id: categoryId ?? undefined, visibility, page, size: SIZE });
  const query = useQuery({
    queryKey: ["documents", "list", params],
    queryFn: async () => (await api.get<Page<DocumentItem>>("/documents", { params })).data,
    placeholderData: keepPreviousData,
  });
  const remove = useMutation({
    mutationFn: (doc: DocumentItem) => api.delete(`/documents/${doc.id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["documents"] });
      qc.invalidateQueries({ queryKey: ["courses"] });
      toast.success("Đã xoá tài liệu");
    },
    onError: toast.error,
  });

  return (
    <>
      <PageHeader
        title="Thư viện tài liệu"
        description={manage ? "Mọi tài liệu của công ty" : "Tài liệu chung của công ty và tài liệu thuộc khoá học của bạn"}
        actions={
          manage && (
            <Button variant="primary" icon={<Upload className="size-4" />} onClick={() => setUploading(true)}>
              Tải tài liệu lên
            </Button>
          )
        }
      />
      <div className="mb-4 flex flex-wrap gap-2">
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3" />
          <Input
            aria-label="Tìm tài liệu"
            placeholder="Tìm theo tiêu đề, tên file"
            className="pl-9"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <CategorySelect
          className="w-auto"
          emptyLabel="Mọi danh mục"
          value={categoryId}
          onChange={(v) => {
            setCategoryId(v);
            setPage(1);
          }}
        />
        <Select
          aria-label="Phạm vi"
          className="w-auto"
          value={visibility}
          onChange={(e) => {
            setVisibility(e.target.value as DocumentVisibility | "");
            setPage(1);
          }}
        >
          <option value="">Mọi phạm vi</option>
          {(Object.keys(VISIBILITY) as DocumentVisibility[]).map((v) => (
            <option key={v} value={v}>
              {VISIBILITY[v].label}
            </option>
          ))}
        </Select>
      </div>

      <Card>
        {query.isPending ? (
          <Spinner />
        ) : !query.data?.items.length ? (
          <Empty title="Chưa có tài liệu" />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <th>Tài liệu</th>
                  <th>Danh mục</th>
                  <th>Phạm vi</th>
                  <th>Dung lượng</th>
                  <th>Ngày tải lên</th>
                  <th className="w-36" />
                </tr>
              </thead>
              <tbody>
                {query.data.items.map((d) => (
                  <tr key={d.id}>
                    <td className="max-w-md">
                      <div className="flex items-center gap-2.5">
                        <FileIcon name={d.file_name} />
                        <div className="min-w-0">
                          <p className="truncate font-medium">{d.title}</p>
                          <p className="truncate text-xs text-ink-3">{d.description || d.file_name}</p>
                        </div>
                      </div>
                    </td>
                    <td className="text-ink-2">{(d.category_id && categoryById.get(d.category_id)?.name) || "—"}</td>
                    <td>
                      <MetaBadge meta={VISIBILITY[d.visibility]} dot={false} />
                    </td>
                    <td className="text-ink-2 tabular-nums">{fmtBytes(d.size_bytes)}</td>
                    <td className="text-ink-2">{fmtDate(d.created_at)}</td>
                    <td>
                      <div className="flex justify-end">
                        <DocumentOpenButtons documentId={d.id} />
                        {manage && (
                          <>
                            <IconButton label="Sửa" onClick={() => setEditing(d)}>
                              <Pencil className="size-4" />
                            </IconButton>
                            <IconButton
                              label="Xoá"
                              className="hover:text-danger"
                              onClick={() => confirm(`Xoá tài liệu "${d.title}"?`) && remove.mutate(d)}
                            >
                              <Trash2 className="size-4" />
                            </IconButton>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pagination page={page} size={SIZE} total={query.data.total} onChange={setPage} />
          </>
        )}
      </Card>

      {uploading && <UploadDocumentModal onClose={() => setUploading(false)} />}
      {editing && <EditDocumentModal doc={editing} onClose={() => setEditing(null)} />}
    </>
  );
}
