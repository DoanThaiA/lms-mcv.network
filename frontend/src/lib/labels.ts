import type {
  CompanyStatus,
  CourseStatus,
  DocumentVisibility,
  EnrollmentSource,
  EnrollmentStatus,
  EnrollMode,
  LessonType,
  LmsRole,
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
  text: { label: "Bài đọc", tone: "gray" },
  video: { label: "Video", tone: "red" },
  document: { label: "Tài liệu", tone: "blue" },
  link: { label: "Liên kết", tone: "violet" },
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
