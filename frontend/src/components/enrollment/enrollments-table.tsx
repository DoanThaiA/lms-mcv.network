"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Eye, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { EnrollmentProgressModal } from "@/components/enrollment/progress-modal";
import { MetaBadge } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { Empty, Pagination, ProgressBar, Spinner, Table, UserChip } from "@/components/ui/misc";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { api, clean } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { ENROLLMENT_SOURCE, ENROLLMENT_STATUS } from "@/lib/labels";
import type { EnrollmentDetail, EnrollmentStatus, Page } from "@/lib/types";
import { fmtDate, fmtPercent, fmtRelative, num } from "@/lib/utils";

export type EnrollmentFilters = {
  course_id?: number;
  user_id?: number;
  status?: EnrollmentStatus | "";
  overdue?: boolean;
  q?: string;
};

const SIZE = 50;

export function useEnrollments(filters: EnrollmentFilters, page: number, size = SIZE) {
  const params = clean({ ...filters, page, size });
  return useQuery({
    queryKey: ["enrollments", "list", params],
    queryFn: async () => (await api.get<Page<EnrollmentDetail>>("/enrollments", { params })).data,
    placeholderData: keepPreviousData,
  });
}

function DueDateModal({ enrollment, onClose }: { enrollment: EnrollmentDetail; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [due, setDue] = useState(enrollment.due_date ?? "");
  const save = useMutation({
    mutationFn: () => api.patch(`/enrollments/${enrollment.id}`, { due_date: due || null }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["enrollments"] });
      qc.invalidateQueries({ queryKey: ["reports"] });
      toast.success("Đã đổi hạn hoàn thành");
      onClose();
    },
    onError: toast.error,
  });
  return (
    <Modal
      open
      size="sm"
      onClose={onClose}
      title="Hạn hoàn thành"
      description={`${enrollment.employee.full_name} · ${enrollment.course_title}`}
      footer={
        <>
          <Button onClick={onClose}>Huỷ</Button>
          <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>
            Lưu
          </Button>
        </>
      }
    >
      <Field label="Hạn" hint="Bỏ trống = không hạn">
        {(id) => <Input id={id} type="date" value={due} onChange={(e) => setDue(e.target.value)} />}
      </Field>
    </Modal>
  );
}

/** Bảng ghi danh / tiến độ; hideCourse khi đã ở trong trang một khoá học. */
export function EnrollmentsTable({
  filters,
  hideCourse,
  emptyText = "Chưa có ghi danh",
}: {
  filters: EnrollmentFilters;
  hideCourse?: boolean;
  emptyText?: string;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const { can } = useAuth();
  const manage = can("enrollment.manage");
  const [page, setPage] = useState(1);
  const [pageKey, setPageKey] = useState(JSON.stringify(filters));
  const [viewing, setViewing] = useState<EnrollmentDetail | null>(null);
  const [editingDue, setEditingDue] = useState<EnrollmentDetail | null>(null);

  // Đổi bộ lọc -> về trang 1
  const key = JSON.stringify(filters);
  if (key !== pageKey) {
    setPageKey(key);
    setPage(1);
  }
  const query = useEnrollments(filters, page);

  const remove = useMutation({
    mutationFn: (e: EnrollmentDetail) => api.delete(`/enrollments/${e.id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["enrollments"] });
      qc.invalidateQueries({ queryKey: ["reports"] });
      toast.success("Đã huỷ ghi danh");
    },
    onError: toast.error,
  });

  if (query.isPending) return <Spinner />;
  if (!query.data?.items.length) return <Empty title={emptyText} />;

  return (
    <>
      <Table>
        <thead>
          <tr>
            <th>Nhân viên</th>
            {!hideCourse && <th>Khoá học</th>}
            <th>Trạng thái</th>
            <th className="w-40">Tiến độ</th>
            <th>Hạn</th>
            <th>Nguồn</th>
            <th>Truy cập</th>
            <th className="w-28" />
          </tr>
        </thead>
        <tbody>
          {query.data.items.map((e) => (
            <tr key={e.id}>
              <td>
                <div className="flex items-center gap-2">
                  <UserChip name={e.employee.full_name} id={e.employee.id} />
                  <span className="text-xs text-ink-3">{e.employee.employee_code}</span>
                </div>
              </td>
              {!hideCourse && (
                <td className="max-w-64">
                  <Link href={`/courses/${e.course_id}`} className="block truncate hover:text-brand">
                    <span className="font-mono text-xs text-ink-3">{e.course_code}</span> {e.course_title}
                  </Link>
                </td>
              )}
              <td>
                <MetaBadge meta={ENROLLMENT_STATUS[e.status]} />
              </td>
              <td>
                <div className="flex items-center gap-2">
                  <ProgressBar value={num(e.progress_percent)} />
                  <span className="w-12 text-right text-xs tabular-nums">{fmtPercent(e.progress_percent)}</span>
                </div>
              </td>
              <td className={e.is_overdue ? "font-medium text-danger" : "text-ink-2"}>
                {fmtDate(e.due_date)}
                {e.is_overdue && <span className="block text-xs">Quá hạn</span>}
              </td>
              <td className="text-ink-2">{ENROLLMENT_SOURCE[e.source]}</td>
              <td className="text-ink-3">{fmtRelative(e.last_accessed_at)}</td>
              <td>
                <div className="flex justify-end">
                  <IconButton label="Xem tiến độ từng bài" onClick={() => setViewing(e)}>
                    <Eye className="size-4" />
                  </IconButton>
                  {manage && (
                    <>
                      <IconButton label="Đổi hạn" onClick={() => setEditingDue(e)}>
                        <CalendarClock className="size-4" />
                      </IconButton>
                      <IconButton
                        label="Huỷ ghi danh"
                        className="hover:text-danger"
                        onClick={() => {
                          if (confirm(`Huỷ ghi danh của ${e.employee.full_name}? Toàn bộ tiến độ học sẽ bị xoá.`))
                            remove.mutate(e);
                        }}
                      >
                        <Trash2 className="size-4" />
                      </IconButton>
                    </>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
      <Pagination page={page} size={SIZE} total={query.data.total} onChange={setPage} />
      {viewing && <EnrollmentProgressModal enrollment={viewing} onClose={() => setViewing(null)} />}
      {editingDue && <DueDateModal enrollment={editingDue} onClose={() => setEditingDue(null)} />}
    </>
  );
}
