"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Circle, PlayCircle } from "lucide-react";
import { useState } from "react";

import { SubmissionList } from "@/components/lesson/standard-lesson";
import { MetaBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form";
import { Modal } from "@/components/ui/modal";
import { ProgressBar, Spinner } from "@/components/ui/misc";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useCourse } from "@/lib/hooks";
import { ENROLLMENT_SOURCE, ENROLLMENT_STATUS, lessonMeta } from "@/lib/labels";
import type { CourseProgress, EnrollmentDetail, ReviewStatus, Submission } from "@/lib/types";
import { fmtDate, fmtDateTime, fmtPercent, num } from "@/lib/utils";

function fmtPosition(s: number) {
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

/** Tiến độ từng bài của một nhân viên trong khoá học (người quản lý xem). */
export function EnrollmentProgressModal({
  enrollment,
  onClose,
}: {
  enrollment: EnrollmentDetail;
  onClose: () => void;
}) {
  const course = useCourse(enrollment.course_id);
  const progress = useQuery({
    queryKey: ["enrollments", enrollment.id, "progress"],
    queryFn: async () => (await api.get<CourseProgress>(`/enrollments/${enrollment.id}/progress`)).data,
  });
  const submissions = useQuery({
    queryKey: ["enrollments", enrollment.id, "submissions"],
    queryFn: async () => (await api.get<Submission[]>(`/enrollments/${enrollment.id}/submissions`)).data,
  });
  const byLesson = new Map((progress.data?.lessons ?? []).map((p) => [p.lesson_id, p]));
  const subsByLesson = new Map<number, Submission[]>();
  for (const s of submissions.data ?? []) subsByLesson.set(s.lesson_id, [...(subsByLesson.get(s.lesson_id) ?? []), s]);
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
            const subs = subsByLesson.get(l.id) ?? [];
            return (
              <li key={l.id} className="px-3 py-2">
                <div className="flex items-center gap-3">
                  {p?.completed_at ? (
                    <CheckCircle2 className="size-4.5 text-emerald-600" />
                  ) : p ? (
                    <PlayCircle className="size-4.5 text-sky-600" />
                  ) : (
                    <Circle className="size-4.5 text-line-strong" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">
                      {i + 1}. {l.title}
                      {!l.is_required && <span className="ml-2 text-xs text-ink-3">(không bắt buộc)</span>}
                    </span>
                    {l.content_type === "standard" && (
                      <span className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-ink-3">
                        <MetaBadge meta={lessonMeta(l)} dot={false} />
                        {p?.video_completed_at && <span>Đã xem hết video</span>}
                        {!!p?.quiz_attempts && (
                          <span className={p.quiz_passed_at ? "text-emerald-700" : undefined}>
                            Kiểm tra: {p.quiz_passed_at ? "đạt" : "chưa đạt"} · cao nhất {p.quiz_score} câu ·{" "}
                            {p.quiz_attempts} lần
                          </span>
                        )}
                        {l.lesson_kind === "practice" && !subs.length && <span>Chưa nộp bài</span>}
                      </span>
                    )}
                  </span>
                  <span className="text-right text-xs text-ink-3">
                    {p?.completed_at
                      ? `Xong ${fmtDateTime(p.completed_at)}`
                      : p
                        ? `Đang học${p.last_position_seconds ? ` · ${fmtPosition(p.last_position_seconds)}` : ""}`
                        : "Chưa học"}
                  </span>
                </div>
                {subs.length > 0 && (
                  <div className="mt-2 ml-7">
                    <SubmissionList
                      items={subs}
                      actions={(s) => <ReviewControls submission={s} enrollmentId={enrollment.id} />}
                    />
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </Modal>
  );
}

/** Chấm bài nộp: đạt / chưa đạt kèm nhận xét (quyền enrollment.manage). */
function ReviewControls({ submission, enrollmentId }: { submission: Submission; enrollmentId: number }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState(submission.review_note ?? "");
  const review = useMutation({
    mutationFn: async (status: ReviewStatus) =>
      api.patch(`/submissions/${submission.id}`, { review_status: status, review_note: note.trim() || null }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["enrollments", enrollmentId, "submissions"] });
      setOpen(false);
      toast.success("Đã lưu kết quả chấm");
    },
    onError: toast.error,
  });
  if (!can("enrollment.manage")) return null;
  if (!open) {
    return (
      <Button size="sm" variant="ghost" className="h-7" onClick={() => setOpen(true)}>
        {submission.review_status === "pending" ? "Chấm bài" : "Chấm lại"}
      </Button>
    );
  }
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <Input
        aria-label="Nhận xét"
        placeholder="Nhận xét (không bắt buộc)"
        className="h-7 w-56"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <Button
        size="sm"
        className="h-7"
        loading={review.isPending && review.variables === "passed"}
        onClick={() => review.mutate("passed")}
      >
        Đạt
      </Button>
      <Button
        size="sm"
        className="h-7"
        loading={review.isPending && review.variables === "failed"}
        onClick={() => review.mutate("failed")}
      >
        Chưa đạt
      </Button>
      <Button size="sm" variant="ghost" className="h-7" onClick={() => setOpen(false)}>
        Huỷ
      </Button>
    </span>
  );
}
