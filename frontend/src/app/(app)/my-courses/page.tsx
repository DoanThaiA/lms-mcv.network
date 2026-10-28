"use client";

import { useState } from "react";

import { CourseCard } from "@/components/course-card";
import { Card, Empty, PageHeader, Spinner } from "@/components/ui/misc";
import { useMyCourses } from "@/lib/hooks";
import { ENROLLMENT_STATUS } from "@/lib/labels";
import type { EnrollmentStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

const TABS: { value: EnrollmentStatus | "" | "overdue"; label: string }[] = [
  { value: "", label: "Tất cả" },
  { value: "not_started", label: ENROLLMENT_STATUS.not_started.label },
  { value: "in_progress", label: ENROLLMENT_STATUS.in_progress.label },
  { value: "completed", label: ENROLLMENT_STATUS.completed.label },
  { value: "overdue", label: "Quá hạn" },
];

export default function MyCoursesPage() {
  const [tab, setTab] = useState<(typeof TABS)[number]["value"]>("");
  const query = useMyCourses();
  const all = query.data ?? [];
  const items = tab === "overdue" ? all.filter((e) => e.is_overdue) : tab ? all.filter((e) => e.status === tab) : all;
  const count = (v: (typeof TABS)[number]["value"]) =>
    v === "overdue" ? all.filter((e) => e.is_overdue).length : v ? all.filter((e) => e.status === v).length : all.length;

  return (
    <>
      <PageHeader title="Khoá học của tôi" description="Khoá học được giao và khoá học bạn tự đăng ký" />
      <div role="tablist" className="mb-4 flex flex-wrap gap-1 border-b border-line">
        {TABS.map((t) => (
          <button
            key={t.value}
            role="tab"
            type="button"
            aria-selected={tab === t.value}
            onClick={() => setTab(t.value)}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-[13px] font-medium",
              tab === t.value ? "border-brand text-brand" : "border-transparent text-ink-3 hover:text-ink",
            )}
          >
            {t.label} <span className="ml-1 text-xs text-ink-3 tabular-nums">{count(t.value)}</span>
          </button>
        ))}
      </div>
      {query.isPending ? (
        <Spinner />
      ) : items.length ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {items.map((e) => (
            <CourseCard key={e.id} course={e.course} enrollment={e} />
          ))}
        </div>
      ) : (
        <Card>
          <Empty title="Không có khoá học" />
        </Card>
      )}
    </>
  );
}
