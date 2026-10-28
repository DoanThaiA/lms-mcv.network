"use client";

import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Circle, PlayCircle } from "lucide-react";

import { MetaBadge } from "@/components/ui/badge";
import { Modal } from "@/components/ui/modal";
import { ProgressBar, Spinner } from "@/components/ui/misc";
import { api } from "@/lib/api";
import { useCourse } from "@/lib/hooks";
import { ENROLLMENT_SOURCE, ENROLLMENT_STATUS } from "@/lib/labels";
import type { CourseProgress, EnrollmentDetail } from "@/lib/types";
import { fmtDate, fmtDateTime, fmtPercent, num } from "@/lib/utils";

function fmtPosition(s: number) {
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

/** Tiến độ từng bài của một nhân viên trong khoá học (người quản lý xem). */
export function EnrollmentProgressModal({ enrollment, onClose }: { enrollment: EnrollmentDetail; onClose: () => void }) {
  const course = useCourse(enrollment.course_id);
  const progress = useQuery({
    queryKey: ["enrollments", enrollment.id, "progress"],
    queryFn: async () => (await api.get<CourseProgress>(`/enrollments/${enrollment.id}/progress`)).data,
  });
  const byLesson = new Map((progress.data?.lessons ?? []).map((p) => [p.lesson_id, p]));
  const e = progress.data?.enrollment ?? enrollment;

  return (
    <Modal
      open
      size="lg"
      onClose={onClose}
      title={`${enrollment.employee.full_name} · ${enrollment.course_code}`}
      description={enrollment.course_title}
    >
      <div className="mb-4 grid gap-3 rounded-lg bg-subtle/70 p-3 text-[13px] sm:grid-cols-4">
        <div>
          <p className="text-ink-3">Trạng thái</p>
          <MetaBadge meta={ENROLLMENT_STATUS[e.status]} />
        </div>
        <div>
          <p className="text-ink-3">Nguồn</p>
          <p>{ENROLLMENT_SOURCE[e.source]}</p>
        </div>
        <div>
          <p className="text-ink-3">Hạn hoàn thành</p>
          <p className={e.is_overdue ? "font-medium text-danger" : undefined}>{fmtDate(e.due_date)}</p>
        </div>
        <div>
          <p className="text-ink-3">Truy cập gần nhất</p>
          <p>{fmtDateTime(e.last_accessed_at)}</p>
        </div>
        <div className="sm:col-span-4">
          <div className="mb-1 flex justify-between text-ink-3">
            <span>Tiến độ</span>
            <span className="font-medium text-ink">{fmtPercent(e.progress_percent)}</span>
          </div>
          <ProgressBar value={num(e.progress_percent)} />
        </div>
      </div>
      {course.isPending || progress.isPending ? (
        <Spinner />
      ) : (
        <ol className="divide-y divide-line rounded-lg border border-line">
          {(course.data?.lessons ?? []).map((l, i) => {
            const p = byLesson.get(l.id);
            return (
              <li key={l.id} className="flex items-center gap-3 px-3 py-2">
                {p?.completed_at ? (
                  <CheckCircle2 className="size-4.5 text-emerald-600" />
                ) : p ? (
                  <PlayCircle className="size-4.5 text-sky-600" />
                ) : (
                  <Circle className="size-4.5 text-line-strong" />
                )}
                <span className="min-w-0 flex-1 truncate">
                  {i + 1}. {l.title}
                  {!l.is_required && <span className="ml-2 text-xs text-ink-3">(không bắt buộc)</span>}
                </span>
                <span className="text-right text-xs text-ink-3">
                  {p?.completed_at
                    ? `Xong ${fmtDateTime(p.completed_at)}`
                    : p
                      ? `Đang học${p.last_position_seconds ? ` · ${fmtPosition(p.last_position_seconds)}` : ""}`
                      : "Chưa học"}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </Modal>
  );
}
