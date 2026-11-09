import type {
  CompanyStatus,
  CourseStatus,
  DocumentVisibility,
  EnrollmentSource,
  EnrollmentStatus,
  EnrollMode,
  LessonKind,
  LessonType,
  LmsRole,
  ReviewStatus,
  UserStatus,
} from "./types";

export type Tone = "gray" | "blue" | "indigo" | "violet" | "amber" | "green" | "red" | "teal" | "orange";

type Meta = { label: string; tone: Tone };

export const ROLE: Record<LmsRole, Meta & { description: string }> = {
  admin: { label: "Quản trị LMS", tone: "violet", description: "Nhân viên, nội dung, giao khoá học, báo cáo" },
  instructor: { label: "Giảng viên", tone: "blue", description: "Soạn khoá học / tài liệu, giao khoá học, báo cáo" },
  learner: { label: "Học viên", tone: "gray", description: "Học khoá được giao, tự đăng ký khoá mở" },
};

export const USER_STATUS: Record<UserStatus, Meta> = {
  active: { label: "Hoạt động", tone: "green" },
  inactive: { label: "Ngừng", tone: "gray" },
  locked: { label: "Đã khoá", tone: "red" },
};

export const COMPANY_STATUS: Record<CompanyStatus, Meta> = {
  active: { label: "Hoạt động", tone: "green" },
  inactive: { label: "Ngừng hoạt động", tone: "gray" },
};

export const COURSE_STATUS: Record<CourseStatus, Meta> = {
  draft: { label: "Nháp", tone: "amber" },
  published: { label: "Đang phát hành", tone: "green" },
  archived: { label: "Lưu trữ", tone: "gray" },
};

// Khớp TRANSITIONS trong backend/app/api/v1/endpoints/courses.py
export const COURSE_TRANSITIONS: Record<CourseStatus, { to: CourseStatus; label: string }[]> = {
  draft: [{ to: "published", label: "Phát hành" }],
  published: [
    { to: "archived", label: "Lưu trữ" },
    { to: "draft", label: "Chuyển về nháp" },
  ],
  archived: [{ to: "published", label: "Phát hành lại" }],
};

export const ENROLL_MODE: Record<EnrollMode, Meta & { description: string }> = {
  open: { label: "Mở đăng ký", tone: "teal", description: "Mọi nhân viên thấy và tự đăng ký" },
  assigned: { label: "Theo phân công", tone: "indigo", description: "Chỉ nhân viên được giao mới thấy" },
};

export const LESSON_TYPE: Record<LessonType, Meta> = {
  standard: { label: "Bài học chuẩn", tone: "teal" },
  text: { label: "Bài đọc", tone: "gray" },
  video: { label: "Video", tone: "red" },
  document: { label: "Tài liệu", tone: "blue" },
  link: { label: "Liên kết", tone: "violet" },
};

export const LESSON_KIND: Record<LessonKind, Meta & { description: string; done: string }> = {
  theory: {
    label: "Lý thuyết",
    tone: "teal",
    description: "Học viên xem hết video và đọc đến cuối bài",
    done: "Xem hết video (nếu có) và đọc đến cuối bài, rồi bấm \"Đánh dấu hoàn thành\"",
  },
  quiz: {
    label: "Lý thuyết + kiểm tra",
    tone: "violet",
    description: "Xem hết video và trả lời đạt câu hỏi trắc nghiệm",
    done: "Xem hết video (nếu có) và trả lời đạt câu hỏi kiểm tra",
  },
  practice: {
    label: "Thực hành",
    tone: "amber",
    description: "Học viên nộp bài (link / file); giảng viên chấm theo tiêu chí đạt",
    done: "Nộp bài: gửi link hoặc tải file kết quả lên; giảng viên chấm theo tiêu chí đạt",
  },
};

/** Nhãn hiển thị của bài: dạng bài với bài học chuẩn, loại bài với bài khác. */
export function lessonMeta(l: { content_type: LessonType; lesson_kind: LessonKind | null }): Meta {
  return l.content_type === "standard" && l.lesson_kind ? LESSON_KIND[l.lesson_kind] : LESSON_TYPE[l.content_type];
}

export const REVIEW_STATUS: Record<ReviewStatus, Meta> = {
  pending: { label: "Chờ chấm", tone: "amber" },
  passed: { label: "Đạt", tone: "green" },
  failed: { label: "Chưa đạt", tone: "red" },
};

export const VISIBILITY: Record<DocumentVisibility, Meta & { description: string }> = {
  company: { label: "Toàn công ty", tone: "green", description: "Mọi nhân viên xem trong thư viện" },
  course: { label: "Theo khoá học", tone: "amber", description: "Chỉ học viên của khoá học có dùng tài liệu" },
};

export const ENROLLMENT_STATUS: Record<EnrollmentStatus, Meta> = {
  not_started: { label: "Chưa học", tone: "gray" },
  in_progress: { label: "Đang học", tone: "blue" },
  completed: { label: "Hoàn thành", tone: "green" },
};

export const ENROLLMENT_SOURCE: Record<EnrollmentSource, string> = {
  assigned: "Được giao",
  self: "Tự đăng ký",
};
