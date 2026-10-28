import { BookOpen, CalendarClock, Clock } from "lucide-react";
import Link from "next/link";

import { MetaBadge } from "@/components/ui/badge";
import { Card, ProgressBar } from "@/components/ui/misc";
import { COURSE_STATUS, ENROLL_MODE, ENROLLMENT_STATUS } from "@/lib/labels";
import type { Course, Enrollment } from "@/lib/types";
import { cn, daysUntil, fmtDate, fmtMinutes, fmtPercent, num } from "@/lib/utils";

/** Ảnh bìa khoá học; không có ảnh thì dùng nền màu theo mã khoá. */
export function CourseCover({ course, className }: { course: Course; className?: string }) {
  const hues = ["from-teal-500 to-emerald-600", "from-sky-500 to-indigo-600", "from-amber-500 to-orange-600",
    "from-violet-500 to-fuchsia-600", "from-rose-500 to-red-600", "from-cyan-500 to-blue-600"];
  const hue = hues[[...course.code].reduce((s, c) => s + c.charCodeAt(0), 0) % hues.length];
  return (
    <div className={cn("relative overflow-hidden bg-gradient-to-br", hue, className)}>
      {course.thumbnail_url ? (
        // eslint-disable-next-line @next/next/no-img-element -- ảnh ngoài do giảng viên nhập
        <img src={course.thumbnail_url} alt="" className="absolute inset-0 size-full object-cover" />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center text-white/90">
          <BookOpen className="size-8" />
        </div>
      )}
    </div>
  );
}

export function DueLabel({ enrollment }: { enrollment: Enrollment }) {
  if (!enrollment.due_date || enrollment.status === "completed") return null;
  const days = daysUntil(enrollment.due_date) ?? 0;
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs", enrollment.is_overdue ? "font-medium text-danger" : days <= 3 ? "text-amber-700" : "text-ink-3")}>
      <CalendarClock className="size-3.5" />
      {enrollment.is_overdue ? `Quá hạn ${fmtDate(enrollment.due_date)}` : `Hạn ${fmtDate(enrollment.due_date)}`}
    </span>
  );
}

export function CourseCard({
  course,
  enrollment,
  showStatus,
}: {
  course: Course;
  enrollment?: Enrollment | null;
  showStatus?: boolean;
}) {
  return (
    <Link href={`/courses/${course.id}`} className="group block">
      <Card className="flex h-full flex-col overflow-hidden transition-shadow group-hover:shadow-pop">
        <CourseCover course={course} className="aspect-[16/7]" />
        <div className="flex flex-1 flex-col gap-2 p-4">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-mono text-xs text-ink-3">{course.code}</span>
            {showStatus && <MetaBadge meta={COURSE_STATUS[course.status]} />}
            {!enrollment && <MetaBadge meta={ENROLL_MODE[course.enroll_mode]} dot={false} />}
            {enrollment && <MetaBadge meta={ENROLLMENT_STATUS[enrollment.status]} />}
          </div>
          <h3 className="line-clamp-2 font-semibold group-hover:text-brand">{course.title}</h3>
          {course.summary && <p className="line-clamp-2 text-[13px] text-ink-3">{course.summary}</p>}
          <div className="mt-auto space-y-2 pt-2">
            {enrollment ? (
              <>
                <div className="flex items-center justify-between text-xs text-ink-3">
                  <span>Tiến độ</span>
                  <span className="font-medium text-ink tabular-nums">{fmtPercent(enrollment.progress_percent)}</span>
                </div>
                <ProgressBar value={num(enrollment.progress_percent)} />
                <DueLabel enrollment={enrollment} />
              </>
            ) : (
              <span className="inline-flex items-center gap-1 text-xs text-ink-3">
                <Clock className="size-3.5" />
                {fmtMinutes(course.estimated_minutes)}
              </span>
            )}
          </div>
        </div>
      </Card>
    </Link>
  );
}
