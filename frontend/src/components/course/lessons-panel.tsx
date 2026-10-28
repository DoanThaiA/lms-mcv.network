"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, CheckCircle2, Circle, Pencil, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { LessonFormModal } from "@/components/course/lesson-form";
import { MetaBadge } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { Card, CardHeader, Empty } from "@/components/ui/misc";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/api";
import { LESSON_TYPE } from "@/lib/labels";
import type { CourseDetail, CourseProgress, Lesson } from "@/lib/types";
import { cn, fmtMinutes } from "@/lib/utils";

/** Danh sách bài học: người soạn thêm / sửa / xoá / sắp xếp; học viên thấy dấu đã học. */
export function LessonsPanel({
  course,
  manage,
  progress,
  canOpen,
}: {
  course: CourseDetail;
  manage: boolean;
  progress?: CourseProgress | null;
  canOpen: boolean;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const done = new Set((progress?.lessons ?? []).filter((p) => p.completed_at).map((p) => p.lesson_id));
  const lessons = course.lessons;

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["courses", course.id] });
    qc.invalidateQueries({ queryKey: ["enrollments"] });
  };
  const reorder = useMutation({
    mutationFn: (ids: number[]) => api.put(`/courses/${course.id}/lessons/order`, { lesson_ids: ids }),
    onSuccess: invalidate,
    onError: toast.error,
  });
  const remove = useMutation({
    mutationFn: (lesson: Lesson) => api.delete(`/courses/${course.id}/lessons/${lesson.id}`),
    onSuccess: () => {
      invalidate();
      toast.success("Đã xoá bài học");
    },
    onError: toast.error,
  });

  const move = (index: number, delta: number) => {
    const ids = lessons.map((l) => l.id);
    [ids[index], ids[index + delta]] = [ids[index + delta], ids[index]];
    reorder.mutate(ids);
  };
  const total = lessons.reduce((s, l) => s + (l.duration_minutes ?? 0), 0);

  return (
    <Card>
      <CardHeader
        title={
          <span>
            Nội dung khoá học{" "}
            <span className="font-normal text-ink-3">
              · {lessons.length} bài{total ? ` · ${fmtMinutes(total)}` : ""}
            </span>
          </span>
        }
        action={
          manage && (
            <Button size="sm" variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing("new")}>
              Thêm bài
            </Button>
          )
        }
      />
      {!lessons.length ? (
        <Empty title="Chưa có bài học" description={manage ? "Thêm ít nhất một bài để phát hành khoá học." : undefined} />
      ) : (
        <ol className="divide-y divide-line">
          {lessons.map((l, i) => {
            const completed = done.has(l.id);
            const title = (
              <span className={cn("font-medium", canOpen && "group-hover:text-brand")}>
                {l.title}
              </span>
            );
            return (
              <li key={l.id} className="group flex items-center gap-3 px-4 py-2.5">
                {progress ? (
                  completed ? (
                    <CheckCircle2 className="size-5 shrink-0 text-emerald-600" aria-label="Đã học" />
                  ) : (
                    <Circle className="size-5 shrink-0 text-line-strong" aria-label="Chưa học" />
                  )
                ) : (
                  <span className="w-5 shrink-0 text-center text-xs text-ink-3 tabular-nums">{i + 1}</span>
                )}
                <div className="min-w-0 flex-1">
                  {canOpen ? (
                    <Link href={`/courses/${course.id}/learn/${l.id}`} className="block truncate">
                      {title}
                    </Link>
                  ) : (
                    <span className="block truncate">{title}</span>
                  )}
                  <span className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-ink-3">
                    <MetaBadge meta={LESSON_TYPE[l.content_type]} dot={false} />
                    {l.duration_minutes ? fmtMinutes(l.duration_minutes) : null}
                    {!l.is_required && <span>Không bắt buộc</span>}
                  </span>
                </div>
                {manage && (
                  <div className="flex shrink-0 items-center">
                    <IconButton label="Lên" disabled={i === 0 || reorder.isPending} onClick={() => move(i, -1)}>
                      <ArrowUp className="size-4" />
                    </IconButton>
                    <IconButton
                      label="Xuống"
                      disabled={i === lessons.length - 1 || reorder.isPending}
                      onClick={() => move(i, 1)}
                    >
                      <ArrowDown className="size-4" />
                    </IconButton>
                    <IconButton label="Sửa" onClick={() => setEditing(l.id)}>
                      <Pencil className="size-4" />
                    </IconButton>
                    <IconButton
                      label="Xoá"
                      className="hover:text-danger"
                      onClick={() => {
                        if (confirm(`Xoá bài "${l.title}"? Tiến độ của học viên ở bài này cũng bị xoá.`)) remove.mutate(l);
                      }}
                    >
                      <Trash2 className="size-4" />
                    </IconButton>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
      {editing !== null && (
        <LessonFormModal
          courseId={course.id}
          lessonId={editing === "new" ? undefined : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </Card>
  );
}
