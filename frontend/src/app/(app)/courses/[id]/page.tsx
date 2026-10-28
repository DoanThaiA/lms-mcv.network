"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, BookOpen, Clock, Pencil, PlayCircle, Trash2, UserPlus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { CourseCover, DueLabel } from "@/components/course-card";
import { CourseDocumentsPanel } from "@/components/course/documents-panel";
import { CourseFormModal } from "@/components/course/course-form";
import { LessonsPanel } from "@/components/course/lessons-panel";
import { AssignModal } from "@/components/enrollment/assign-modal";
import { EnrollmentsTable, useEnrollments } from "@/components/enrollment/enrollments-table";
import { MetaBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/form";
import { Card, CardHeader, Empty, ProgressBar, Spinner } from "@/components/ui/misc";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useCategories, useCourse, useMyProgress, useNumberParam } from "@/lib/hooks";
import { COURSE_STATUS, COURSE_TRANSITIONS, ENROLL_MODE, ENROLLMENT_STATUS } from "@/lib/labels";
import type { CourseDetail, CourseStatus, EnrollmentStatus } from "@/lib/types";
import { cn, fmtDate, fmtMinutes, fmtPercent, num } from "@/lib/utils";

type Tab = "content" | "students";

function StudentsTab({ course }: { course: CourseDetail }) {
  const { can } = useAuth();
  const [status, setStatus] = useState<EnrollmentStatus | "">("");
  const [assigning, setAssigning] = useState(false);
  const all = useEnrollments({ course_id: course.id }, 1, 200);
  const enrolledIds = new Set((all.data?.items ?? []).map((e) => e.user_id));

  return (
    <Card>
      <CardHeader
        title={`Học viên (${all.data?.total ?? 0})`}
        action={
          <div className="flex items-center gap-2">
            <Select
              aria-label="Lọc trạng thái"
              className="h-8 w-auto text-[13px]"
              value={status}
              onChange={(e) => setStatus(e.target.value as EnrollmentStatus | "")}
            >
              <option value="">Mọi trạng thái</option>
              {(Object.keys(ENROLLMENT_STATUS) as EnrollmentStatus[]).map((s) => (
                <option key={s} value={s}>
                  {ENROLLMENT_STATUS[s].label}
                </option>
              ))}
            </Select>
            {can("enrollment.manage") && (
              <Button
                size="sm"
                variant="primary"
                icon={<UserPlus className="size-4" />}
                disabled={course.status !== "published"}
                title={course.status !== "published" ? "Chỉ giao được khoá học đang phát hành" : undefined}
                onClick={() => setAssigning(true)}
              >
                Giao khoá học
              </Button>
            )}
          </div>
        }
      />
      <EnrollmentsTable hideCourse filters={{ course_id: course.id, status }} emptyText="Chưa có học viên" />
      {assigning && (
        <AssignModal
          courseId={course.id}
          courseTitle={course.title}
          enrolledUserIds={enrolledIds}
          onClose={() => setAssigning(false)}
        />
      )}
    </Card>
  );
}

export default function CourseDetailPage() {
  const id = useNumberParam("id");
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const { can } = useAuth();
  const manage = can("content.manage");
  const course = useCourse(id);
  const progress = useMyProgress(id, !!course.data);
  const { byId: categoryById } = useCategories();
  const [tab, setTab] = useState<Tab>("content");
  const [editing, setEditing] = useState(false);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["courses"] });
    qc.invalidateQueries({ queryKey: ["my-courses"] });
    qc.invalidateQueries({ queryKey: ["my-progress", id] });
    qc.invalidateQueries({ queryKey: ["reports"] });
  };
  const changeStatus = useMutation({
    mutationFn: (status: CourseStatus) => api.post(`/courses/${id}/status`, { status }),
    onSuccess: () => {
      invalidate();
      toast.success("Đã cập nhật trạng thái khoá học");
    },
    onError: toast.error,
  });
  const remove = useMutation({
    mutationFn: () => api.delete(`/courses/${id}`),
    onSuccess: () => {
      invalidate();
      toast.success("Đã xoá khoá học");
      router.replace("/courses");
    },
    onError: toast.error,
  });
  const enroll = useMutation({
    mutationFn: () => api.post(`/me/courses/${id}/enroll`),
    onSuccess: () => {
      invalidate();
      toast.success("Đã đăng ký khoá học");
    },
    onError: toast.error,
  });

  if (course.isPending) return <Spinner />;
  if (!course.data) {
    return (
      <Card>
        <Empty
          title="Không tìm thấy khoá học"
          description="Khoá học không tồn tại hoặc bạn không được xem."
          action={<Link href="/courses" className="text-brand hover:underline">Về danh mục khoá học</Link>}
        />
      </Card>
    );
  }

  const c = course.data;
  const enrollment = progress.data?.enrollment;
  const done = new Set((progress.data?.lessons ?? []).filter((p) => p.completed_at).map((p) => p.lesson_id));
  const nextLesson = c.lessons.find((l) => !done.has(l.id)) ?? c.lessons[0];
  // Người soạn nội dung xem được mọi bài; học viên phải ghi danh
  const canOpen = manage || !!enrollment;
  const canSelfEnroll = !enrollment && c.status === "published" && c.enroll_mode === "open";

  return (
    <>
      <Link href="/courses" className="mb-3 inline-flex items-center gap-1 text-[13px] text-ink-3 hover:text-ink">
        <ArrowLeft className="size-4" /> Danh mục khoá học
      </Link>

      <Card className="mb-5 overflow-hidden">
        <div className="grid md:grid-cols-[320px_1fr]">
          <CourseCover course={c} className="aspect-[16/9] md:aspect-auto md:min-h-48" />
          <div className="flex flex-col gap-3 p-5">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-mono text-xs text-ink-3">{c.code}</span>
              {manage && <MetaBadge meta={COURSE_STATUS[c.status]} />}
              <MetaBadge meta={ENROLL_MODE[c.enroll_mode]} dot={false} />
              {c.category_id && categoryById.get(c.category_id) && (
                <span className="text-xs text-ink-3">· {categoryById.get(c.category_id)!.name}</span>
              )}
            </div>
            <h1 className="text-xl font-semibold tracking-tight">{c.title}</h1>
            {c.summary && <p className="text-ink-2">{c.summary}</p>}
            <div className="flex flex-wrap gap-4 text-[13px] text-ink-3">
              <span className="inline-flex items-center gap-1">
                <BookOpen className="size-4" /> {c.lessons.length} bài học
              </span>
              <span className="inline-flex items-center gap-1">
                <Clock className="size-4" /> {fmtMinutes(c.estimated_minutes)}
              </span>
              {c.published_at && <span>Phát hành {fmtDate(c.published_at)}</span>}
            </div>

            {enrollment && (
              <div className="max-w-md space-y-1.5">
                <div className="flex items-center justify-between text-[13px]">
                  <MetaBadge meta={ENROLLMENT_STATUS[enrollment.status]} />
                  <span className="font-medium tabular-nums">{fmtPercent(enrollment.progress_percent)}</span>
                </div>
                <ProgressBar value={num(enrollment.progress_percent)} />
                <DueLabel enrollment={enrollment} />
              </div>
            )}

            <div className="mt-auto flex flex-wrap gap-2 pt-1">
              {enrollment && nextLesson && (
                <Link href={`/courses/${c.id}/learn/${nextLesson.id}`}>
                  <Button variant="primary" icon={<PlayCircle className="size-4" />}>
                    {enrollment.status === "not_started" ? "Bắt đầu học" : enrollment.status === "completed" ? "Xem lại" : "Tiếp tục học"}
                  </Button>
                </Link>
              )}
              {canSelfEnroll && (
                <Button variant="primary" loading={enroll.isPending} onClick={() => enroll.mutate()}>
                  Đăng ký khoá học
                </Button>
              )}
              {manage && (
                <>
                  <Button icon={<Pencil className="size-4" />} onClick={() => setEditing(true)}>
                    Sửa thông tin
                  </Button>
                  {COURSE_TRANSITIONS[c.status].map((t) => (
                    <Button
                      key={t.to}
                      variant={t.to === "published" ? "primary" : "secondary"}
                      loading={changeStatus.isPending && changeStatus.variables === t.to}
                      onClick={() => changeStatus.mutate(t.to)}
                    >
                      {t.label}
                    </Button>
                  ))}
                  {c.status !== "published" && (
                    <Button
                      variant="ghost"
                      className="hover:text-danger"
                      icon={<Trash2 className="size-4" />}
                      onClick={() => confirm(`Xoá khoá học "${c.title}"?`) && remove.mutate()}
                    >
                      Xoá
                    </Button>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </Card>

      {can("report.view") && (
        <div role="tablist" className="mb-4 flex gap-1 border-b border-line">
          {(
            [
              ["content", "Nội dung"],
              ["students", "Học viên & tiến độ"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              role="tab"
              type="button"
              aria-selected={tab === value}
              onClick={() => setTab(value)}
              className={cn(
                "-mb-px border-b-2 px-3 py-2 text-[13px] font-medium",
                tab === value ? "border-brand text-brand" : "border-transparent text-ink-3 hover:text-ink",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {tab === "students" && can("report.view") ? (
        <StudentsTab course={c} />
      ) : (
        <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
          <div className="space-y-5">
            {c.description && (
              <Card>
                <CardHeader title="Giới thiệu" />
                <p className="lesson-prose px-4 py-3 text-ink-2">{c.description}</p>
              </Card>
            )}
            <LessonsPanel course={c} manage={manage} progress={progress.data} canOpen={canOpen} />
          </div>
          <div>
            <CourseDocumentsPanel course={c} manage={manage} canOpen={canOpen} />
          </div>
        </div>
      )}

      {editing && <CourseFormModal course={c} onClose={() => setEditing(false)} onSaved={() => setEditing(false)} />}
    </>
  );
}
