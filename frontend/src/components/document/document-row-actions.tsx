"use client";

import { useMutation } from "@tanstack/react-query";
import { Download, Eye } from "lucide-react";
import { useState } from "react";

import { documentPreview, FilePreviewModal, type PreviewFile } from "@/components/file-preview";
import { IconButton } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/api";
import type { DocumentDetail } from "@/lib/types";

/** Nút xem trước / tải về: lấy link ký tạm mới mỗi lần bấm (link hết hạn sau 1 giờ). */
export function DocumentOpenButtons({ documentId }: { documentId: number }) {
  const toast = useToast();
  const [preview, setPreview] = useState<PreviewFile | null>(null);
  const fetchDoc = useMutation({
    mutationFn: async () => (await api.get<DocumentDetail>(`/documents/${documentId}`)).data,
    onError: toast.error,
  });

  return (
    <>
      <IconButton
        label="Xem trước"
        disabled={fetchDoc.isPending}
        onClick={async () => {
          const doc = await fetchDoc.mutateAsync();
          const file = documentPreview(doc);
          if (file) setPreview(file);
          else if (doc.download_url) window.open(doc.download_url, "_blank", "noopener");
          else toast.error("Loại file này chỉ tải về được, nhưng chưa cấu hình lưu trữ");
        }}
      >
        <Eye className="size-4" />
      </IconButton>
      <IconButton
        label="Tải về"
        disabled={fetchDoc.isPending}
        onClick={async () => {
          const doc = await fetchDoc.mutateAsync();
          if (doc.download_url) window.open(doc.download_url, "_blank", "noopener");
          else toast.error("Chưa cấu hình lưu trữ file (Cloudflare R2)");
        }}
      >
        <Download className="size-4" />
      </IconButton>
      {preview && <FilePreviewModal file={preview} onClose={() => setPreview(null)} />}
    </>
  );
}
