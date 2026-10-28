"use client";

import { useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { MetaBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/form";
import { Card, Empty, PageHeader, ProgressBar, Spinner, Stat, Table } from "@/components/ui/misc";
import { api, clean } from "@/lib/api";
import { COURSE_STATUS } from "@/lib/labels";
import type { CourseReport, CourseStatus } from "@/lib/types";
import { fmtPercent, num, todayISO } from "@/lib/utils";

const COLUMNS: [keyof CourseReport, string][] = [
  ["code", "Mã"],
  ["title", "Khoá học"],
  ["status", "Trạng thái"],
  ["enrolled", "Ghi danh"],
  ["not_started", "Chưa học"],
  ["in_progress", "Đang học"],
  ["completed", "Hoàn thành"],
  ["overdue", "Quá hạn"],
  ["completion_rate", "Tỉ lệ hoàn thành (%)"],
];

/** Xuất CSV (UTF-8 BOM để Excel đọc đúng tiếng Việt). */
function exportCsv(rows: CourseReport[]) {
  const esc = (v: unknown) => `"${String(v ?? "").replaceAll('"', '""')}"`;
  const lines = [
    COLUMNS.map(([, label]) => esc(label)).join(","),
    ...rows.map((r) =>
      COLUMNS.map(([k]) => esc(k === "status" ? COURSE_STATUS[r.status].label : r[k])).join(","),
    ),
  ];
  const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `bao-cao-khoa-hoc-${todayISO()}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export default function ReportsPage() {
  const [status, setStatus] = useState<CourseStatus | "">("published");
  const report = useQuery({
    queryKey: ["reports", "courses", status],
    queryFn: async () => (await api.get<CourseReport[]>("/reports/courses", { params: clean({ status }) })).data,
  });
  const rows = report.data ?? [];
  const sum = (k: keyof CourseReport) => rows.reduce((s, r) => s + Number(r[k]), 0);
  const enrolled = sum("enrolled");

  return (
    <>
      <PageHeader
        title="Báo cáo đào tạo"
        description="Thống kê ghi danh và hoàn thành theo khoá học"
        actions={
          <>
            <Select
              aria-label="Trạng thái khoá học"
              className="w-auto"
              value={status}
              onChange={(e) => setStatus(e.target.value as CourseStatus | "")}
            >
              <option value="">Mọi khoá học</option>
              {(Object.keys(COURSE_STATUS) as CourseStatus[]).map((s) => (
                <option key={s} value={s}>
                  {COURSE_STATUS[s].label}
                </option>
              ))}
            </Select>
            <Button icon={<Download className="size-4" />} disabled={!rows.length} onClick={() => exportCsv(rows)}>
              Xuất CSV
            </Button>
          </>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Khoá học" value={rows.length} />
        <Stat label="Lượt ghi danh" value={enrolled} />
        <Stat label="Đang học" value={sum("in_progress")} sub={`${sum("not_started")} chưa bắt đầu`} />
        <Stat
          label="Hoàn thành"
          value={sum("completed")}
          sub={enrolled ? `${fmtPercent((100 * sum("completed")) / enrolled)} lượt ghi danh` : undefined}
        />
        <Stat label="Quá hạn" value={<span className={sum("overdue") ? "text-danger" : undefined}>{sum("overdue")}</span>} />
      </div>

      <Card>
        {report.isPending ? (
          <Spinner />
        ) : !rows.length ? (
          <Empty title="Chưa có dữ liệu" />
        ) : (
          <Table>
            <thead>
              <tr>
                <th>Khoá học</th>
                <th>Trạng thái</th>
                <th className="text-right">Ghi danh</th>
                <th className="text-right">Chưa học</th>
                <th className="text-right">Đang học</th>
                <th className="text-right">Hoàn thành</th>
                <th className="text-right">Quá hạn</th>
                <th className="w-48">Tỉ lệ hoàn thành</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.course_id}>
                  <td>
                    <Link href={`/courses/${r.course_id}`} className="hover:text-brand">
                      <span className="font-mono text-xs text-ink-3">{r.code}</span>{" "}
                      <span className="font-medium">{r.title}</span>
                    </Link>
                  </td>
                  <td>
                    <MetaBadge meta={COURSE_STATUS[r.status]} />
                  </td>
                  <td className="text-right tabular-nums">
                    <Link href={`/enrollments?course_id=${r.course_id}`} className="hover:text-brand hover:underline">
                      {r.enrolled}
                    </Link>
                  </td>
                  <td className="text-right tabular-nums">{r.not_started}</td>
                  <td className="text-right tabular-nums">{r.in_progress}</td>
                  <td className="text-right tabular-nums">{r.completed}</td>
                  <td className="text-right tabular-nums">
                    {r.overdue ? (
                      <Link
                        href={`/enrollments?course_id=${r.course_id}&overdue=true`}
                        className="font-medium text-danger hover:underline"
                        title="Xem danh sách quá hạn"
                      >
                        {r.overdue}
                      </Link>
                    ) : (
                      0
                    )}
                  </td>
                  <td>
                    <div className="flex items-center gap-2">
                      <ProgressBar value={num(r.completion_rate)} />
                      <span className="w-12 text-right text-xs tabular-nums">{fmtPercent(r.completion_rate)}</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
