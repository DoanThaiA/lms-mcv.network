"use client";

import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useDeferredValue, useState } from "react";

import { EnrollmentsTable } from "@/components/enrollment/enrollments-table";
import { Input, Select } from "@/components/ui/form";
import { Card, PageHeader } from "@/components/ui/misc";
import { api } from "@/lib/api";
import { ENROLLMENT_STATUS } from "@/lib/labels";
import type { Course, EnrollmentStatus, Page } from "@/lib/types";

export default function EnrollmentsPage() {
  // Bộ lọc ban đầu từ URL, vd từ trang báo cáo: /enrollments?course_id=3&overdue=true
  const params = useSearchParams();
  const [q, setQ] = useState("");
  const [courseId, setCourseId] = useState<number | undefined>(Number(params.get("course_id")) || undefined);
  const [status, setStatus] = useState<EnrollmentStatus | "">((params.get("status") as EnrollmentStatus) ?? "");
  const [overdue, setOverdue] = useState<"" | "true" | "false">(
    params.get("overdue") === "true" ? "true" : params.get("overdue") === "false" ? "false" : "",
  );
  const search = useDeferredValue(q);
  const courses = useQuery({
    queryKey: ["courses", "all-for-filter"],
    queryFn: async () => (await api.get<Page<Course>>("/courses", { params: { size: 100 } })).data.items,
  });

  return (
    <>
      <PageHeader title="Ghi danh & tiến độ" description="Theo dõi nhân viên học các khoá được giao / tự đăng ký" />
      <div className="mb-4 flex flex-wrap gap-2">
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3" />
          <Input
            aria-label="Tìm nhân viên"
            placeholder="Mã / tên nhân viên"
            className="pl-9"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <Select
          aria-label="Khoá học"
          className="w-auto max-w-72"
          value={courseId ?? ""}
          onChange={(e) => setCourseId(e.target.value ? Number(e.target.value) : undefined)}
        >
          <option value="">Mọi khoá học</option>
          {(courses.data ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.code} · {c.title}
            </option>
          ))}
        </Select>
        <Select
          aria-label="Trạng thái"
          className="w-auto"
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
        <Select
          aria-label="Hạn"
          className="w-auto"
          value={overdue}
          onChange={(e) => setOverdue(e.target.value as "" | "true" | "false")}
        >
          <option value="">Mọi hạn</option>
          <option value="true">Quá hạn</option>
          <option value="false">Chưa quá hạn</option>
        </Select>
      </div>
      <Card>
        <EnrollmentsTable
          filters={{ q: search, course_id: courseId, status, overdue: overdue ? overdue === "true" : undefined }}
          emptyText="Không có ghi danh phù hợp"
        />
      </Card>
    </>
  );
}
