"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { useDeferredValue, useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input } from "@/components/ui/form";
import { Avatar, Spinner } from "@/components/ui/misc";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { api, clean } from "@/lib/api";
import type { AssignResult, Employee } from "@/lib/types";
import { cn, todayISO } from "@/lib/utils";

/** Giao khoá học cho nhiều nhân viên; nhân viên đã ghi danh được bỏ qua. */
export function AssignModal({
  courseId,
  courseTitle,
  enrolledUserIds,
  onClose,
}: {
  courseId: number;
  courseTitle: string;
  enrolledUserIds: Set<number>;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [dueDate, setDueDate] = useState("");
  const search = useDeferredValue(q);
  const lookup = useQuery({
    queryKey: ["employees", "lookup", search],
    queryFn: async () =>
      (await api.get<Employee[]>("/employees/lookup", { params: clean({ q: search, limit: 500 }) })).data,
  });
  const candidates = (lookup.data ?? []).filter((e) => !enrolledUserIds.has(e.id));

  const assign = useMutation({
    mutationFn: async () =>
      (
        await api.post<AssignResult>(`/courses/${courseId}/enrollments`, {
          user_ids: [...selected],
          due_date: dueDate || null,
        })
      ).data,
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["enrollments"] });
      qc.invalidateQueries({ queryKey: ["reports"] });
      toast.success(
        `Đã giao cho ${res.created.length} nhân viên` +
          (res.skipped_user_ids.length ? ` (${res.skipped_user_ids.length} người đã ghi danh trước)` : ""),
      );
      onClose();
    },
    onError: toast.error,
  });

  const allVisibleSelected = candidates.length > 0 && candidates.every((e) => selected.has(e.id));
  const toggle = (id: number) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <Modal
      open
      size="lg"
      onClose={onClose}
      title="Giao khoá học"
      description={courseTitle}
      footer={
        <>
          <Button onClick={onClose}>Huỷ</Button>
          <Button variant="primary" loading={assign.isPending} disabled={!selected.size} onClick={() => assign.mutate()}>
            Giao cho {selected.size} nhân viên
          </Button>
        </>
      }
    >
      <div className="mb-3 grid gap-3 sm:grid-cols-[1fr_200px]">
        <div className="relative self-end">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3" />
          <Input
            aria-label="Tìm nhân viên"
            placeholder="Tìm mã nhân viên, họ tên, email"
            className="pl-9"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <Field label="Hạn hoàn thành" hint="Bỏ trống = không hạn">
          {(id) => <Input id={id} type="date" min={todayISO()} value={dueDate} onChange={(e) => setDueDate(e.target.value)} />}
        </Field>
      </div>
      <div className="mb-2 flex items-center justify-between text-[13px]">
        <Checkbox
          label={`Chọn tất cả (${candidates.length})`}
          checked={allVisibleSelected}
          disabled={!candidates.length}
          onChange={(e) =>
            setSelected((s) => {
              const next = new Set(s);
              candidates.forEach((c) => (e.target.checked ? next.add(c.id) : next.delete(c.id)));
              return next;
            })
          }
        />
        <span className="text-ink-3">Đã chọn {selected.size}</span>
      </div>
      {lookup.isPending ? (
        <Spinner />
      ) : !candidates.length ? (
        <p className="py-8 text-center text-ink-3">Không còn nhân viên nào chưa ghi danh</p>
      ) : (
        <ul className="max-h-[45vh] divide-y divide-line overflow-y-auto rounded-lg border border-line">
          {candidates.map((e) => (
            <li key={e.id}>
              <label className={cn("flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-subtle", selected.has(e.id) && "bg-brand-soft/60")}>
                <input type="checkbox" className="size-4 accent-brand" checked={selected.has(e.id)} onChange={() => toggle(e.id)} />
                <Avatar name={e.full_name} id={e.id} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{e.full_name}</span>
                  <span className="block truncate text-xs text-ink-3">
                    {e.employee_code} {e.job_title ? `· ${e.job_title}` : ""}
                  </span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
