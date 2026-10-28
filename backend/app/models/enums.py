from enum import StrEnum


class UserStatus(StrEnum):  # kiểu ENUM user_status của project_manager
    active = "active"
    inactive = "inactive"
    locked = "locked"


class CompanyStatus(StrEnum):
    active = "active"
    inactive = "inactive"


class LmsRole(StrEnum):
    admin = "admin"  # quản trị LMS của công ty: nhân viên, nội dung, giao khoá học, báo cáo
    instructor = "instructor"  # soạn khoá học / tài liệu, giao khoá học, xem báo cáo
    learner = "learner"


class DocumentVisibility(StrEnum):
    company = "company"  # mọi nhân viên trong công ty
    course = "course"  # chỉ học viên khoá học có dùng tài liệu


class CourseStatus(StrEnum):
    draft = "draft"
    published = "published"
    archived = "archived"


class EnrollMode(StrEnum):
    open = "open"  # nhân viên tự đăng ký
    assigned = "assigned"  # chỉ người được giao


class LessonType(StrEnum):
    text = "text"
    video = "video"
    document = "document"
    link = "link"


class EnrollmentSource(StrEnum):
    assigned = "assigned"
    self = "self"


class EnrollmentStatus(StrEnum):
    not_started = "not_started"
    in_progress = "in_progress"
    completed = "completed"
