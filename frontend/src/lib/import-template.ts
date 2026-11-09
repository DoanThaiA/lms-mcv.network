/*
 * Nhập bài học từ file khoá học HTML theo mẫu "AI thực chiến – Phòng Kinh doanh":
 * file có <script> khai báo RESOURCES (videos, files), PARTS và LESSONS
 * ({id, part, dur, type: lt|qz|th, title, goals, files, body, quiz, submit, allowText}).
 *
 * Nội dung bài (body) là template string JavaScript (${P(`...`)}, ${L.r}...) nên phải chạy script của file mới có
 * HTML cuối cùng. Script chạy trong iframe sandbox KHÔNG có allow-same-origin: origin rỗng, không đọc được
 * localStorage / cookie / DOM của LMS; chỉ gửi dữ liệu ra bằng postMessage, dữ liệu nhận về được kiểm tra lại.
 */

import type { DocumentItem, LessonKind } from "./types";

export type TemplateData = { lessons: unknown; parts: unknown; resources: unknown };

/** Chạy file HTML trong iframe sandbox, lấy LESSONS / PARTS / RESOURCES. */
export function extractTemplate(html: string, timeoutMs = 10_000): Promise<TemplateData> {
  return new Promise((resolve, reject) => {
    const token = Math.random().toString(36).slice(2);
    const probe =
      "<script>(function(){var d={};" +
      'try{d.lessons=typeof LESSONS!=="undefined"?LESSONS:null}catch(e){}' +
      'try{d.parts=typeof PARTS!=="undefined"?PARTS:null}catch(e){}' +
      'try{d.resources=typeof RESOURCES!=="undefined"?RESOURCES:null}catch(e){}' +
      `try{parent.postMessage({importToken:"${token}",data:JSON.parse(JSON.stringify(d))},"*")}` +
      `catch(e){parent.postMessage({importToken:"${token}",error:String(e)},"*")}})()</` +
      "script>";
    const iframe = document.createElement("iframe");
    iframe.setAttribute("sandbox", "allow-scripts");
    iframe.style.display = "none";

    const cleanup = () => {
      window.removeEventListener("message", onMessage);
      clearTimeout(timer);
      iframe.remove();
    };
    const onMessage = (e: MessageEvent) => {
      if (e.source !== iframe.contentWindow || e.data?.importToken !== token) return;
      cleanup();
      if (e.data.error) reject(new Error(`Không đọc được dữ liệu bài học: ${e.data.error}`));
      else resolve(e.data.data as TemplateData);
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Hết thời gian đọc file (script của file không chạy xong)"));
    }, timeoutMs);
    window.addEventListener("message", onMessage);
    // Script dò dữ liệu đặt sau toàn bộ file: chạy sau script gốc, đọc được const khai báo ở phạm vi toàn cục
    iframe.srcdoc = html + probe;
    document.body.appendChild(iframe);
  });
}

// ------------------------------------------------------------------ chuyển sang bài học LMS

export type LessonPayload = {
  title: string;
  content_type: "standard";
  lesson_kind: LessonKind;
  duration_minutes: number | null;
  is_required: boolean;
  goals: string[];
  body: string;
  external_url: string | null;
  video_minutes: number | null;
  quiz: {
    pass_score: number | null;
    must_correct: number[];
    questions: { question: string; options: string[]; answer: number; explanation: string | null }[];
  } | null;
  assignment: { requirement: string; criteria: string[]; allow_text: boolean } | null;
  practice_document_ids: number[];
};

export type ImportFile = { key: string; name: string; description: string; url: string; document?: DocumentItem };

export type ImportRow = {
  key: string;
  code: string;
  partTitle: string;
  payload: LessonPayload | null; // null = lỗi, không nhập được
  errors: string[];
  warnings: string[];
  files: ImportFile[];
};

const KINDS: Record<string, LessonKind> = { lt: "theory", qz: "quiz", th: "practice" };

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const strList = (v: unknown) => (Array.isArray(v) ? v.map(str).filter(Boolean) : []);
const int = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v) : null);

function escapeHtml(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

function httpUrl(v: string): string | null {
  try {
    const u = new URL(v);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/**
 * Dữ liệu file mẫu -> danh sách bài học để xem trước và gửi POST /courses/{id}/lessons/bulk.
 * docsByName: tài liệu thư viện theo tên file (chữ thường) để tự gắn "Tài liệu thực hành".
 */
export function buildImportRows(data: TemplateData, docsByName: Map<string, DocumentItem>): ImportRow[] {
  if (!Array.isArray(data.lessons) || !data.lessons.length) {
    throw new Error("File không có danh sách bài học (LESSONS) theo mẫu");
  }
  const parts = new Map(
    (Array.isArray(data.parts) ? data.parts : []).map((p) => [str(obj(p).id), str(obj(p).title)] as const),
  );
  const resources = obj(data.resources);
  const videos = obj(resources.videos);
  const fileDefs = obj(resources.files);

  return data.lessons.map((raw, index) => {
    const l = obj(raw);
    const code = str(l.id);
    const errors: string[] = [];
    const warnings: string[] = [];
    const name = str(l.title);
    const title = (code && name ? `${code} · ${name}` : name || code).slice(0, 255);
    if (!title) errors.push("Thiếu tên bài");

    let kind = KINDS[str(l.type)];
    if (!kind) {
      warnings.push(`Loại bài "${str(l.type) || "?"}" không rõ: nhập thành Lý thuyết`);
      kind = "theory";
    }

    // Video
    const video = obj(videos[code]);
    const rawUrl = str(video.url);
    const external_url = rawUrl ? httpUrl(rawUrl) : null;
    if (rawUrl && !external_url) warnings.push(`Link video không hợp lệ, bỏ qua: ${rawUrl}`);
    const video_minutes = external_url ? int(video.min) || null : null;

    // Tài liệu thực hành: khớp tên file với thư viện; chưa có thì liệt kê link (nếu có) cuối nội dung
    const files: ImportFile[] = strList(l.files).map((key) => {
      const f = obj(fileDefs[key]);
      const fileName = str(f.name) || key;
      return {
        key,
        name: fileName,
        description: str(f.desc),
        url: str(f.url),
        document: docsByName.get(fileName.toLowerCase()),
      };
    });
    const external = files.filter((f) => !f.document && httpUrl(f.url));
    let body = typeof l.body === "string" ? l.body.trim() : "";
    if (external.length) {
      body +=
        "\n<h2>📎 Tài liệu tải về</h2>\n<ul>\n" +
        external
          .map(
            (f) =>
              `<li><a href="${escapeHtml(httpUrl(f.url)!)}">${escapeHtml(f.name)}</a>${f.description ? ` – ${escapeHtml(f.description)}` : ""}</li>`,
          )
          .join("\n") +
        "\n</ul>";
    }
    const missing = files.filter((f) => !f.document && !httpUrl(f.url));
    if (missing.length) warnings.push(`Chưa có trong thư viện: ${missing.map((f) => f.name).join(", ")}`);

    // Câu hỏi kiểm tra
    let quiz: LessonPayload["quiz"] = null;
    if (kind === "quiz") {
      const q = obj(l.quiz);
      const qs = Array.isArray(q.qs) ? q.qs.map(obj) : [];
      const questions = qs.map((x, i) => {
        const options = strList(x.o);
        const answer = int(x.a);
        if (!str(x.q)) errors.push(`Câu ${i + 1} thiếu nội dung`);
        if (options.length < 2) errors.push(`Câu ${i + 1} cần ít nhất 2 phương án`);
        if (answer === null || answer >= options.length) errors.push(`Câu ${i + 1} có đáp án không hợp lệ`);
        return { question: str(x.q), options, answer: answer ?? 0, explanation: str(x.e) || null };
      });
      if (!questions.length) errors.push("Bài kiểm tra không có câu hỏi");
      const passScore = q.passAll ? null : int(q.passScore);
      const mustRight = (Array.isArray(q.mustRight) ? q.mustRight : [])
        .map(int)
        .filter((i): i is number => i !== null && i < questions.length);
      if (!q.passAll && passScore === null) warnings.push("Không có điều kiện đạt: cần đúng tất cả");
      quiz = {
        pass_score: passScore && passScore <= questions.length ? passScore : null,
        must_correct: mustRight,
        questions,
      };
    }

    // Nộp bài
    let assignment: LessonPayload["assignment"] = null;
    if (kind === "practice") {
      const s = obj(l.submit);
      const requirement = str(s.need);
      if (!requirement) errors.push("Bài thực hành thiếu yêu cầu nộp bài (submit.need)");
      assignment = {
        requirement: requirement.slice(0, 4000),
        criteria: strList(s.criteria),
        allow_text: !!l.allowText,
      };
    }

    const goals = strList(l.goals);
    if (!body && !goals.length && !external_url) errors.push("Bài không có mục tiêu, video hay nội dung");

    return {
      key: `${index}-${code}`,
      code,
      partTitle: parts.get(str(l.part)) ?? "",
      errors,
      warnings,
      files,
      payload: errors.length
        ? null
        : {
            title,
            content_type: "standard",
            lesson_kind: kind,
            duration_minutes: int(l.dur),
            is_required: true,
            goals,
            body,
            external_url,
            video_minutes,
            quiz,
            assignment,
            practice_document_ids: [...new Set(files.flatMap((f) => (f.document ? [f.document.id] : [])))],
          },
    };
  });
}
