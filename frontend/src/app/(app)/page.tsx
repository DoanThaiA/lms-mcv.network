"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { CourseCard } from "@/components/course-card";
import { Card, CardHeader, Empty, PageHeader, Spinner, Stat } from "@/components/ui/misc";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useMyCourses } from "@/lib/hooks";
import type { Course, CourseReport, Page } from "@/lib/types";
import { fmtPercent } from "@/lib/utils";

function ManagerSummary() {
  const report = useQuery({
    queryKey: ["reports", "courses", "published"],
    queryFn: async () => (await api.get<CourseReport[]>("/reports/courses", { params: { status: "published" } })).data,
  });
  if (!report.data) return null;
  const sum = (k: keyof CourseReport) => report.data.reduce((s, r) => s + Number(r[k]), 0);
  const enrolled = sum("enrolled");
  return (
    <Card className="mb-6">
      <CardHeader
        title="Đào tạo trong công ty (khoá đang phát hành)"
        action={
          <Link href="/reports" className="inline-flex items-center gap-1 text-[13px] font-medium text-brand hover:underline">
            Báo cáo <ArrowRight className="size-3.5" />
          </Link>
        }
      />
      <div className="grid grid-cols-2 gap-px bg-line sm:grid-cols-5 [&>*]:rounded-none [&>*]:border-0 [&>*]:shadow-none">
        <Stat label="Khoá học" value={report.data.length} />
        <Stat label="Lượt ghi danh" value={enrolled} />
        <Stat label="Đang học" value={sum("in_progress")} />
        <Stat label="Hoàn thành" value={sum("completed")} sub={enrolled ? fmtPercent((100 * sum("completed")) / enrolled) : undefined} />
        <Stat label="Quá hạn" value={<span className={sum("overdue") ? "text-danger" : undefined}>{sum("overdue")}</span>} />
      </div>
    </Card>
  );
}

export default function DashboardPage() {
  const { me, can } = useAuth();
  const mine = useMyCourses();
  const open = useQuery({
    queryKey: ["courses", "catalog-open"],
    queryFn: async () =>
      (await api.get<Page<Course>>("/courses", { params: { enroll_mode: "open", status: "published", size: 12 } })).data,
  });

  const list = mine.data ?? [];
  const active = list.filter((e) => e.status !== "completed");
  const enrolledIds = new Set(list.map((e) => e.course_id));
  const suggestions = (open.data?.items ?? []).filter((c) => c.status === "published" && !enrolledIds.has(c.id)).slice(0, 4);

  return (
    <>
      <PageHeader
        title={`Xin chào, ${me?.user.full_name}`}
        description={`${me?.company.name} · Mã nhân viên ${me?.user.employee_code}`}
      />

      {can("report.view") && <ManagerSummary />}

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Khoá học của tôi" value={mine.isPending ? "—" : list.length} />
        <Stat label="Đang học" value={mine.isPending ? "—" : list.filter((e) => e.status === "in_progress").length} />
        <Stat label="Đã hoàn thành" value={mine.isPending ? "—" : list.filter((e) => e.status === "completed").length} />
        <Stat
          label="Quá hạn"
          value={
            mine.isPending ? (
              "—"
            ) : (
              <span className={list.some((e) => e.is_overdue) ? "text-danger" : undefined}>
                {list.filter((e) => e.is_overdue).length}
              </span>
            )
          }
        />
      </div>

      <section className="mb-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold">Tiếp tục học</h2>
          <Link href="/my-courses" className="text-[13px] font-medium text-brand hover:underline">
            Xem tất cả
          </Link>
        </div>
        {mine.isPending ? (
          <Spinner />
        ) : active.length ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {active.slice(0, 8).map((e) => (
              <CourseCard key={e.id} course={e.course} enrollment={e} />
            ))}
          </div>
        ) : (
          <Card>
            <Empty
              title={list.length ? "Bạn đã hoàn thành mọi khoá học" : "Chưa có khoá học nào"}
              description="Khoá học được giao sẽ hiện ở đây. Bạn cũng có thể tự đăng ký các khoá mở."
              action={
                <Link href="/courses" className="text-sm font-medium text-brand hover:underline">
                  Xem danh mục khoá học
                </Link>
              }
            />
          </Card>
        )}
      </section>

      {suggestions.length > 0 && (
        <section>
          <h2 className="mb-3 text-base font-semibold">Khoá học mở đăng ký</h2>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {suggestions.map((c) => (
              <CourseCard key={c.id} course={c} />
            ))}
          </div>
        </section>
      )}
    </>
  );
}
