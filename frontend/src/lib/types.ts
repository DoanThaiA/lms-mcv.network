// Kiểu dữ liệu khớp schema backend (backend/app/schemas). Decimal trả về dạng chuỗi.

export type Page<T> = { items: T[]; total: number; page: number; size: number };

export type LmsRole = "admin" | "instructor" | "learner";
export type UserStatus = "active" | "inactive" | "locked";
export type CompanyStatus = "active" | "inactive";
export type CourseStatus = "draft" | "published" | "archived";
export type EnrollMode = "open" | "assigned";
export type LessonType = "text" | "video" | "document" | "link";
export type DocumentVisibility = "company" | "course";
export type EnrollmentStatus = "not_started" | "in_progress" | "completed";
export type EnrollmentSource = "assigned" | "self";
export type PreviewKind = "pdf" | "image" | "video" | "audio" | "text" | "office";

export type Permission = "company.manage" | "employee.manage" | "content.manage" | "enrollment.manage" | "report.view";

export type CompanyBrief = { id: number; code: string; name: string; short_name: string | null; logo_url: string | null };

export type Company = CompanyBrief & {
  tax_code: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  status: CompanyStatus;
  created_at: string;
};

export type EmployeeBrief = { id: number; employee_code: string | null; full_name: string; avatar_url: string | null };

export type Employee = EmployeeBrief & {
  username: string;
  email: string;
  phone: string | null;
  job_title: string | null;
  company_id: number | null;
  status: UserStatus;
  last_login_at: string | null;
  created_at: string;
};

export type EmployeeDetail = Employee & { role: LmsRole };

export type Me = {
  user: Employee;
  company: CompanyBrief;
  role: LmsRole;
  is_system_admin: boolean;
  permissions: Permission[];
};

export type Category = { id: number; name: string; description: string | null; sort_order: number };

export type DocumentItem = {
  id: number;
  category_id: number | null;
  title: string;
  description: string | null;
  file_name: string;
  content_type: string | null;
  size_bytes: number;
  visibility: DocumentVisibility;
  uploaded_by: number | null;
  created_at: string;
  updated_at: string;
};

export type DocumentDetail = DocumentItem & {
  download_url: string;
  preview_kind: PreviewKind | null;
  preview_url: string | null;
};

export type Lesson = {
  id: number;
  course_id: number;
  title: string;
  content_type: LessonType;
  duration_minutes: number | null;
  sort_order: number;
  is_required: boolean;
};

export type LessonDetail = Lesson & {
  body: string | null;
  external_url: string | null;
  document_id: number | null;
  document: DocumentDetail | null;
};

export type Course = {
  id: number;
  category_id: number | null;
  code: string;
  title: string;
  summary: string | null;
  thumbnail_url: string | null;
  status: CourseStatus;
  enroll_mode: EnrollMode;
  estimated_minutes: number | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
};

export type CourseDetail = Course & {
  description: string | null;
  created_by: number | null;
  lessons: Lesson[];
  documents: DocumentItem[];
};

export type Enrollment = {
  id: number;
  course_id: number;
  user_id: number;
  source: EnrollmentSource;
  assigned_by: number | null;
  due_date: string | null;
  status: EnrollmentStatus;
  progress_percent: string;
  started_at: string | null;
  completed_at: string | null;
  last_accessed_at: string | null;
  created_at: string;
  is_overdue: boolean;
};

export type EnrollmentDetail = Enrollment & { employee: EmployeeBrief; course_code: string; course_title: string };

export type MyCourse = Enrollment & { course: Course };

export type LessonProgress = {
  lesson_id: number;
  started_at: string;
  completed_at: string | null;
  last_position_seconds: number;
};

export type CourseProgress = { enrollment: Enrollment; lessons: LessonProgress[] };

export type AssignResult = { created: Enrollment[]; skipped_user_ids: number[] };

export type CourseReport = {
  course_id: number;
  code: string;
  title: string;
  status: CourseStatus;
  enrolled: number;
  not_started: number;
  in_progress: number;
  completed: number;
  overdue: number;
  completion_rate: string;
};
