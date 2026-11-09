"use client";

import DOMPurify from "dompurify";
import { useMemo } from "react";

import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

/*
 * Nội dung bài học chuẩn là HTML do giảng viên soạn (giống phần body của mẫu "AI thực chiến").
 * Luôn lọc qua DOMPurify trước khi hiển thị: bỏ script, sự kiện on*, style, iframe, form...
 * Class được giữ để dùng các khối định dạng sẵn (xem .lesson-html trong globals.css):
 *   <pre class="prompt">      khối câu lệnh, có nút "Sao chép"
 *   <div class="card warn">   khung lưu ý (vàng) · <div class="card rule"> khung ghi nhớ (xám) · <div class="card">
 *   <p class="hint">          chữ nhỏ, màu nhạt
 *   <span class="light-pill lp-r|lp-y|lp-g">  nhãn Đỏ / Vàng / Xanh
 */

let hooked = false;
function purifier() {
  if (!hooked) {
    hooked = true;
    DOMPurify.addHook("afterSanitizeAttributes", (node) => {
      if (node.tagName === "A" && node.getAttribute("href")) {
        node.setAttribute("target", "_blank");
        node.setAttribute("rel", "noopener noreferrer");
      }
    });
  }
  return DOMPurify;
}

const looksLikeHtml = (s: string) => /<\/?[a-z][a-z0-9]*(\s[^>]*)?>/i.test(s);

function escapeHtml(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

/** Văn bản thường (không có thẻ HTML) -> đoạn văn, giữ xuống dòng. */
function plainToHtml(s: string) {
  return s
    .trim()
    .split(/\n\s*\n/)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

/** HTML đã lọc, khối câu lệnh được bọc kèm nút sao chép. Chỉ chạy trên trình duyệt. */
export function sanitizeLessonHtml(raw: string): string {
  if (typeof window === "undefined" || !raw.trim()) return "";
  const html = looksLikeHtml(raw) ? raw : plainToHtml(raw);
  const root = purifier().sanitize(html, {
    RETURN_DOM: true,
    FORBID_TAGS: ["style", "form", "input", "button", "textarea", "select"],
    FORBID_ATTR: ["style"],
  }) as HTMLElement;
  root.querySelectorAll("pre.prompt").forEach((pre) => {
    const wrap = document.createElement("div");
    wrap.className = "prompt-wrap";
    pre.replaceWith(wrap);
    wrap.appendChild(pre);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "copy-btn";
    btn.dataset.copy = "";
    btn.textContent = "Sao chép";
    wrap.appendChild(btn);
  });
  root.querySelectorAll("table").forEach((table) => {
    const wrap = document.createElement("div");
    wrap.className = "table-wrap"; // bảng rộng cuộn ngang trên điện thoại
    table.replaceWith(wrap);
    wrap.appendChild(table);
  });
  return root.innerHTML;
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
}

export function RichContent({ html, className }: { html: string; className?: string }) {
  const toast = useToast();
  const clean = useMemo(() => sanitizeLessonHtml(html), [html]);
  if (!clean) return null;
  return (
    <div
      className={cn("lesson-html", className)}
      onClick={async (e) => {
        const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-copy]");
        const pre = btn?.parentElement?.querySelector("pre");
        if (!btn || !pre) return;
        await copyText(pre.innerText);
        btn.textContent = "Đã chép ✓";
        setTimeout(() => (btn.textContent = "Sao chép"), 1500);
        toast.success("Đã sao chép câu lệnh");
      }}
      dangerouslySetInnerHTML={{ __html: clean }}
    />
  );
}
