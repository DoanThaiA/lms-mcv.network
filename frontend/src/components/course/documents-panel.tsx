"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FileText, Pencil } from "lucide-react";
import { useState } from "react";

import { DocumentOpenButtons } from "@/components/document/document-row-actions";
import { DocumentPickerModal } from "@/components/document/document-picker";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, Empty } from "@/components/ui/misc";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/api";
import type { CourseDetail } from "@/lib/types";
import { fmtBytes } from "@/lib/utils";

/** Tài liệu tham khảo của khoá học. */
export function CourseDocumentsPanel({
  course,
  manage,
  canOpen,
}: {
  course: CourseDetail;
  manage: boolean;
  canOpen: boolean;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [picking, setPicking] = useState(false);
  const save = useMutation({
    mutationFn: (ids: number[]) => api.put(`/courses/${course.id}/documents`, { document_ids: ids }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["courses", course.id] });
      toast.success("Đã cập nhật tài liệu tham khảo");
      setPicking(false);
    },
    onError: toast.error,
  });

  return (
    <Card>
      <CardHeader
        title={`Tài liệu tham khảo (${course.documents.length})`}
        action={
          manage && (
            <Button size="sm" icon={<Pencil className="size-4" />} onClick={() => setPicking(true)}>
              Chọn tài liệu
            </Button>
          )
        }
      />
      {!course.documents.length ? (
        <Empty title="Chưa có tài liệu tham khảo" />
      ) : (
        <ul className="divide-y divide-line">
          {course.documents.map((d) => (
            <li key={d.id} className="flex items-center gap-3 px-4 py-2.5">
              <FileText className="size-4 shrink-0 text-ink-3" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{d.title}</p>
                <p className="truncate text-xs text-ink-3">
                  {d.file_name} · {fmtBytes(d.size_bytes)}
                </p>
              </div>
              {canOpen && <DocumentOpenButtons documentId={d.id} />}
            </li>
          ))}
        </ul>
      )}
      {picking && (
        <DocumentPickerModal
          multiple
          title="Tài liệu tham khảo của khoá học"
          initial={course.documents.map((d) => d.id)}
          onClose={() => setPicking(false)}
          onConfirm={(ids) => save.mutate(ids)}
        />
      )}
    </Card>
  );
}
