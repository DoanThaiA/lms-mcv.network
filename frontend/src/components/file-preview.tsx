"use client";

import { Download, ExternalLink } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import type { DocumentDetail, PreviewKind } from "@/lib/types";

export type { PreviewKind };

/** File xem được trực tiếp: `previewUrl` mở inline trên trình duyệt, `url` tải về. */
export type PreviewFile = { name: string; url?: string; previewKind: PreviewKind; previewUrl: string };

/** Word / Excel / PowerPoint: Microsoft Office Online tải file qua link ký tạm rồi hiển thị. */
const officeViewer = (url: string) => `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(url)}`;

/** Xem file ngay trên trình duyệt (PDF, ảnh, video, audio, văn bản, Office) — không cần tải về. */
export function FilePreviewModal({ file, onClose }: { file: PreviewFile; onClose: () => void }) {
  const { previewKind: kind, previewUrl: src } = file;
  const openUrl = kind === "office" ? officeViewer(src) : src;
  const frame = "h-[72vh] w-full rounded-lg border border-line bg-white";

  return (
    <Modal
      open
      size="xl"
      title={file.name}
      onClose={onClose}
      footer={
        <>
          {kind === "office" && (
            <p className="mr-auto self-center text-xs text-ink-3">Xem qua Microsoft Office Online</p>
          )}
          <a href={openUrl} target="_blank" rel="noopener noreferrer">
            <Button icon={<ExternalLink className="size-4" />}>Mở tab mới</Button>
          </a>
          {file.url && (
            <a href={file.url} target="_blank" rel="noopener noreferrer">
              <Button variant="primary" icon={<Download className="size-4" />}>
                Tải về
              </Button>
            </a>
          )}
        </>
      }
    >
      {kind === "image" ? (
        // eslint-disable-next-line @next/next/no-img-element -- file trên R2 qua link ký tạm, không qua next/image
        <img src={src} alt={file.name} className="mx-auto max-h-[72vh] rounded-lg object-contain" />
      ) : kind === "video" ? (
        <video src={src} controls className="mx-auto max-h-[72vh] w-full rounded-lg bg-black" />
      ) : kind === "audio" ? (
        <audio src={src} controls className="w-full" />
      ) : (
        // pdf / text: trình duyệt tự hiển thị; office: trình xem của Office Online
        <iframe src={openUrl} title={file.name} className={frame} />
      )}
    </Modal>
  );
}

/** Tài liệu LMS -> PreviewFile (null nếu loại file chỉ tải về được). */
export function documentPreview(doc: DocumentDetail): PreviewFile | null {
  if (!doc.preview_kind || !doc.preview_url) return null;
  return { name: doc.file_name, url: doc.download_url, previewKind: doc.preview_kind, previewUrl: doc.preview_url };
}

/** URL nhúng cho video YouTube / Vimeo; null nếu là link khác. */
export function embedVideoUrl(url: string): string | null {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\.|^m\./, "");
    if (host === "youtu.be") return `https://www.youtube.com/embed/${u.pathname.slice(1)}`;
    if (host === "youtube.com") {
      const id = u.searchParams.get("v") ?? u.pathname.match(/^\/(?:embed|shorts)\/([^/]+)/)?.[1];
      return id ? `https://www.youtube.com/embed/${id}` : null;
    }
    if (host === "vimeo.com") {
      const id = u.pathname.match(/^\/(\d+)/)?.[1];
      return id ? `https://player.vimeo.com/video/${id}` : null;
    }
  } catch {
    /* URL không hợp lệ */
  }
  return null;
}
