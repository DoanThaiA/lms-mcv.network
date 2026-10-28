"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import { Button, IconButton } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/form";
import { Card, Empty, PageHeader, Spinner, Table } from "@/components/ui/misc";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/api";
import { useCategories } from "@/lib/hooks";
import type { Category } from "@/lib/types";

function CategoryModal({ category, nextOrder, onClose }: { category?: Category; nextOrder: number; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState({
    name: category?.name ?? "",
    description: category?.description ?? "",
    sort_order: String(category?.sort_order ?? nextOrder),
  });
  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: form.name.trim(),
        description: form.description.trim() || null,
        sort_order: Number(form.sort_order) || 0,
      };
      return category ? api.patch(`/categories/${category.id}`, body) : api.post("/categories", body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["categories"] });
      toast.success(category ? "Đã lưu danh mục" : "Đã tạo danh mục");
      onClose();
    },
    onError: toast.error,
  });
  return (
    <Modal
      open
      size="sm"
      onClose={onClose}
      title={category ? "Sửa danh mục" : "Danh mục mới"}
      footer={
        <>
          <Button onClick={onClose}>Huỷ</Button>
          <Button variant="primary" loading={save.isPending} disabled={!form.name.trim()} onClick={() => save.mutate()}>
            Lưu
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Tên danh mục" required>
          {(id) => <Input id={id} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />}
        </Field>
        <Field label="Mô tả">
          {(id) => <Textarea id={id} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />}
        </Field>
        <Field label="Thứ tự hiển thị">
          {(id) => (
            <Input id={id} type="number" value={form.sort_order} onChange={(e) => setForm({ ...form, sort_order: e.target.value })} />
          )}
        </Field>
      </div>
    </Modal>
  );
}

export default function CategoriesPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const { categories, isPending } = useCategories();
  const [editing, setEditing] = useState<Category | "new" | null>(null);
  const remove = useMutation({
    mutationFn: (c: Category) => api.delete(`/categories/${c.id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["categories"] });
      toast.success("Đã xoá danh mục");
    },
    onError: toast.error,
  });

  return (
    <>
      <PageHeader
        title="Danh mục"
        description="Phân loại khoá học và tài liệu"
        actions={
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing("new")}>
            Danh mục mới
          </Button>
        }
      />
      <Card>
        {isPending ? (
          <Spinner />
        ) : !categories.length ? (
          <Empty title="Chưa có danh mục" />
        ) : (
          <Table>
            <thead>
              <tr>
                <th className="w-20">Thứ tự</th>
                <th>Tên</th>
                <th>Mô tả</th>
                <th className="w-24" />
              </tr>
            </thead>
            <tbody>
              {categories.map((c) => (
                <tr key={c.id}>
                  <td className="tabular-nums text-ink-3">{c.sort_order}</td>
                  <td className="font-medium">{c.name}</td>
                  <td className="text-ink-2">{c.description || "—"}</td>
                  <td>
                    <div className="flex justify-end">
                      <IconButton label="Sửa" onClick={() => setEditing(c)}>
                        <Pencil className="size-4" />
                      </IconButton>
                      <IconButton
                        label="Xoá"
                        className="hover:text-danger"
                        onClick={() =>
                          confirm(`Xoá danh mục "${c.name}"? Khoá học / tài liệu trong danh mục chuyển về "không danh mục".`) &&
                          remove.mutate(c)
                        }
                      >
                        <Trash2 className="size-4" />
                      </IconButton>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      {editing && (
        <CategoryModal
          category={editing === "new" ? undefined : editing}
          nextOrder={Math.max(0, ...categories.map((c) => c.sort_order)) + 1}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}
