"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { CategorySelect } from "@/components/category-select";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/api";
import { ENROLL_MODE } from "@/lib/labels";
import type { CourseDetail, EnrollMode } from "@/lib/types";

const CODE_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,29}$/;

/** Tạo khoá học mới (course undefined) hoặc sửa thông tin khoá học. */
export function CourseFormModal({
  course,
  onClose,
  onSaved,
}: {
  course?: CourseDetail;
  onClose: () => void;
  onSaved: (course: CourseDetail) => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState({
    code: course?.code ?? "",
    title: course?.title ?? "",
    summary: course?.summary ?? "",
    description: course?.description ?? "",
    category_id: course?.category_id ?? null,
    thumbnail_url: course?.thumbnail_url ?? "",
    enroll_mode: course?.enroll_mode ?? ("assigned" as EnrollMode),
    estimated_minutes: course?.estimated_minutes?.toString() ?? "",
  });
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  const save = useMutation({
    mutationFn: async () => {
      const body = {
        code: form.code.trim(),
        title: form.title.trim(),
        summary: form.summary.trim() || null,
        description: form.description.trim() || null,
        category_id: form.category_id,
        thumbnail_url: form.thumbnail_url.trim() || null,
        enroll_mode: form.enroll_mode,
        estimated_minutes: form.estimated_minutes ? Number(form.estimated_minutes) : null,
      };
      const res = course
        ? await api.patch<CourseDetail>(`/courses/${course.id}`, body)
        : await api.post<CourseDetail>("/courses", body);
      return res.data;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["courses"] });
      qc.invalidateQueries({ queryKey: ["reports"] });
      toast.success(course ? "Đã lưu khoá học" : "Đã tạo khoá học");
      onSaved(data);
    },
    onError: toast.error,
  });

  const valid = CODE_RE.test(form.code.trim()) && form.title.trim();

  return (
    <Modal
      open
      size="lg"
      onClose={onClose}
      title={course ? `Sửa khoá học ${course.code}` : "Khoá học mới"}
      footer={
        <>
          <Button onClick={onClose}>Huỷ</Button>
          <Button variant="primary" loading={save.isPending} disabled={!valid} onClick={() => save.mutate()}>
            {course ? "Lưu" : "Tạo khoá học"}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-[180px_1fr]">
        <Field label="Mã khoá học" required hint="Chữ, số, . _ -">
          {(id) => <Input id={id} value={form.code} onChange={(e) => set("code", e.target.value)} placeholder="HN01" />}
        </Field>
        <Field label="Tên khoá học" required>
          {(id) => <Input id={id} value={form.title} onChange={(e) => set("title", e.target.value)} />}
        </Field>
        <Field label="Mô tả ngắn" className="sm:col-span-2" hint="Hiện trên thẻ khoá học (tối đa 500 ký tự)">
          {(id) => <Input id={id} maxLength={500} value={form.summary} onChange={(e) => set("summary", e.target.value)} />}
        </Field>
        <Field label="Giới thiệu chi tiết" className="sm:col-span-2">
          {(id) => (
            <Textarea id={id} rows={5} value={form.description} onChange={(e) => set("description", e.target.value)} />
          )}
        </Field>
        <Field label="Danh mục" className="sm:col-span-2 lg:col-span-1">
          {(id) => <CategorySelect id={id} value={form.category_id} onChange={(v) => set("category_id", v)} />}
        </Field>
        <Field label="Hình thức ghi danh" className="sm:col-span-2 lg:col-span-1" hint={ENROLL_MODE[form.enroll_mode].description}>
          {(id) => (
            <Select id={id} value={form.enroll_mode} onChange={(e) => set("enroll_mode", e.target.value as EnrollMode)}>
              {(Object.keys(ENROLL_MODE) as EnrollMode[]).map((m) => (
                <option key={m} value={m}>
                  {ENROLL_MODE[m].label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Thời lượng dự kiến (phút)">
          {(id) => (
            <Input
              id={id}
              type="number"
              min={0}
              value={form.estimated_minutes}
              onChange={(e) => set("estimated_minutes", e.target.value)}
            />
          )}
        </Field>
        <Field label="Ảnh bìa (URL)" hint="Bỏ trống = nền màu theo mã khoá">
          {(id) => (
            <Input
              id={id}
              type="url"
              value={form.thumbnail_url}
              onChange={(e) => set("thumbnail_url", e.target.value)}
              placeholder="https://…"
            />
          )}
        </Field>
      </div>
    </Modal>
  );
}
