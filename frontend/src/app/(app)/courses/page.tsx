"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { LayoutGrid, List, Plus, Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useDeferredValue, useState } from "react";

import { CategorySelect } from "@/components/category-select";
import { CourseCard } from "@/components/course-card";
import { CourseFormModal } from "@/components/course/course-form";
import { MetaBadge } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form";
import { Card, Empty, PageHeader, Pagination, Spinner, Table } from "@/components/ui/misc";
import { api, clean } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useCategories, useMyCourses } from "@/lib/hooks";
import { COURSE_STATUS, ENROLL_MODE } from "@/lib/labels";
import type { Course, CourseStatus, EnrollMode, Page } from "@/lib/types";
import { fmtDate, fmtMinutes } from "@/lib/utils";

const SIZE = 24;

export default function CoursesPage() {
  const { can } = useAuth();
  const manage = can("content.manage");
  const router = useRouter();
  const { byId: categoryById } = useCategories();
  const [q, setQ] = useState("");
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [status, setStatus] = useState<CourseStatus | "">("");
  const [mode, setMode] = useState<EnrollMode | "">("");
  const [page, setPage] = useState(1);
  const [view, setView] = useState<"grid" | "table">("grid");
  const [creating, setCreating] = useState(false);
  const search = useDeferredValue(q);

  const params = clean({ q: search, category_id: categoryId ?? undefined, status, enroll_mode: mode, page, size: SIZE });
  const query = useQuery({
    queryKey: ["courses", "list", params],
    queryFn: async () => (await api.get<Page<Course>>("/courses", { params })).data,
    placeholderData: keepPreviousData,
  });
  const mine = useMyCourses();
  const enrollmentByCourse = new Map((mine.data ?? []).map((e) => [e.course_id, e]));
  const reset = () => setPage(1);

  return (
    <>
      <PageHeader
        title="Danh mục khoá học"
        description={manage ? "Mọi khoá học của công ty" : "Khoá học mở đăng ký và khoá học được giao cho bạn"}
        actions={
          manage && (
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
              Khoá học mới
            </Button>
          )
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3" />
          <Input
            aria-label="Tìm khoá học"
            placeholder="Tìm theo mã, tên khoá học"
            className="pl-9"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              reset();
            }}
          />
        </div>
        <CategorySelect
          className="w-auto"
          emptyLabel="Mọi danh mục"
          value={categoryId}
          onChange={(v) => {
            setCategoryId(v);
            reset();
          }}
        />
        {manage && (
          <Select
            aria-label="Trạng thái"
            className="w-auto"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as CourseStatus | "");
              reset();
            }}
          >
            <option value="">Mọi trạng thái</option>
            {(Object.keys(COURSE_STATUS) as CourseStatus[]).map((s) => (
              <option key={s} value={s}>
                {COURSE_STATUS[s].label}
              </option>
            ))}
          </Select>
        )}
        <Select
          aria-label="Hình thức ghi danh"
          className="w-auto"
          value={mode}
          onChange={(e) => {
            setMode(e.target.value as EnrollMode | "");
            reset();
          }}
        >
          <option value="">Mọi hình thức</option>
          {(Object.keys(ENROLL_MODE) as EnrollMode[]).map((m) => (
            <option key={m} value={m}>
              {ENROLL_MODE[m].label}
            </option>
          ))}
        </Select>
        <div className="ml-auto flex rounded-lg border border-line-strong bg-surface p-0.5">
          <IconButton label="Dạng lưới" className={view === "grid" ? "bg-subtle text-ink" : ""} onClick={() => setView("grid")}>
            <LayoutGrid className="size-4" />
          </IconButton>
          <IconButton label="Dạng bảng" className={view === "table" ? "bg-subtle text-ink" : ""} onClick={() => setView("table")}>
            <List className="size-4" />
          </IconButton>
        </div>
      </div>

      {query.isPending ? (
        <Spinner />
      ) : !query.data?.items.length ? (
        <Card>
          <Empty
            title="Không có khoá học"
            description={manage ? "Tạo khoá học đầu tiên, thêm bài học rồi phát hành." : undefined}
          />
        </Card>
      ) : view === "grid" ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {query.data.items.map((c) => (
              <CourseCard key={c.id} course={c} enrollment={enrollmentByCourse.get(c.id)} showStatus={manage} />
            ))}
          </div>
          <Card className="mt-4">
            <Pagination page={page} size={SIZE} total={query.data.total} onChange={setPage} />
          </Card>
        </>
      ) : (
        <Card>
          <Table>
            <thead>
              <tr>
                <th>Mã</th>
                <th>Khoá học</th>
                <th>Danh mục</th>
                <th>Hình thức</th>
                {manage && <th>Trạng thái</th>}
                <th>Thời lượng</th>
                <th>Phát hành</th>
              </tr>
            </thead>
            <tbody>
              {query.data.items.map((c) => (
                <tr key={c.id}>
                  <td className="font-mono text-xs">{c.code}</td>
                  <td>
                    <Link href={`/courses/${c.id}`} className="font-medium hover:text-brand">
                      {c.title}
                    </Link>
                  </td>
                  <td className="text-ink-2">{(c.category_id && categoryById.get(c.category_id)?.name) || "—"}</td>
                  <td>
                    <MetaBadge meta={ENROLL_MODE[c.enroll_mode]} dot={false} />
                  </td>
                  {manage && (
                    <td>
                      <MetaBadge meta={COURSE_STATUS[c.status]} />
                    </td>
                  )}
                  <td className="text-ink-2">{fmtMinutes(c.estimated_minutes)}</td>
                  <td className="text-ink-2">{fmtDate(c.published_at)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
          <Pagination page={page} size={SIZE} total={query.data.total} onChange={setPage} />
        </Card>
      )}

      {creating && (
        <CourseFormModal onClose={() => setCreating(false)} onSaved={(c) => {
            setCreating(false);
            router.push(`/courses/${c.id}`);
          }} />
      )}
    </>
  );
}
