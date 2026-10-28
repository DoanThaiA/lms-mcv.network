-- =====================================================================
-- LMS doanh nghiệp — schema gốc (revision 0001)
-- Chạy trong database project_manager, SAU revision 0008 của project_manager
-- (bảng companies, users.company_id / users.employee_code, UNIQUE users(company_id, id)).
-- Dùng lại hàm của project_manager: fn_set_updated_at(), fn_audit_log() (ghi activity_logs).
-- Mọi bảng có company_id; FK kép (company_id, ...) đảm bảo dữ liệu không gắn nhầm công ty khác.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Vai trò LMS của nhân viên (không có dòng = learner)
-- ---------------------------------------------------------------------
CREATE TABLE lms_user_roles (
    user_id     bigint PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    role        varchar(20) NOT NULL CHECK (role IN ('admin', 'instructor', 'learner')),
    granted_by  bigint REFERENCES users(id) ON DELETE SET NULL,
    granted_at  timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE lms_user_roles IS 'Vai trò LMS: admin (quản trị LMS công ty), instructor (soạn nội dung, giao khoá học), learner';

-- ---------------------------------------------------------------------
-- 2. Danh mục (dùng chung cho khoá học và tài liệu)
-- ---------------------------------------------------------------------
CREATE TABLE lms_categories (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    company_id  bigint NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    name        varchar(150) NOT NULL,
    description text,
    sort_order  integer NOT NULL DEFAULT 0,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (company_id, name),
    UNIQUE (company_id, id)
);

-- ---------------------------------------------------------------------
-- 3. Tài liệu (file trên Cloudflare R2)
--   visibility: company = mọi nhân viên xem trong thư viện
--               course  = chỉ học viên của khoá học có dùng tài liệu
-- ---------------------------------------------------------------------
CREATE TABLE lms_documents (
    id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    company_id   bigint NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    category_id  bigint,
    title        varchar(255) NOT NULL,
    description  text,
    file_name    varchar(255) NOT NULL,
    storage_key  varchar(500) NOT NULL UNIQUE,
    content_type varchar(150),
    size_bytes   bigint NOT NULL CHECK (size_bytes >= 0),
    visibility   varchar(10) NOT NULL DEFAULT 'company' CHECK (visibility IN ('company', 'course')),
    uploaded_by  bigint REFERENCES users(id) ON DELETE SET NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    deleted_at   timestamptz,
    UNIQUE (company_id, id),
    FOREIGN KEY (company_id, category_id) REFERENCES lms_categories(company_id, id) ON DELETE SET NULL (category_id)
);
CREATE INDEX idx_lms_documents_company ON lms_documents(company_id, created_at DESC) WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------
-- 4. Khoá học
--   status: draft -> published -> archived (archived mở lại được)
--   enroll_mode: open = nhân viên tự đăng ký; assigned = chỉ người được giao
-- ---------------------------------------------------------------------
CREATE TABLE lms_courses (
    id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    company_id        bigint NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    category_id       bigint,
    code              citext NOT NULL CHECK (code ~ '^[A-Za-z0-9][A-Za-z0-9_.-]{0,29}$'),
    title             varchar(255) NOT NULL,
    summary           varchar(500),
    description       text,
    thumbnail_url     varchar(500),
    status            varchar(10) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
    enroll_mode       varchar(10) NOT NULL DEFAULT 'assigned' CHECK (enroll_mode IN ('open', 'assigned')),
    estimated_minutes integer CHECK (estimated_minutes >= 0),
    created_by        bigint REFERENCES users(id) ON DELETE SET NULL,
    published_at      timestamptz,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now(),
    deleted_at        timestamptz,
    UNIQUE (company_id, id),
    FOREIGN KEY (company_id, category_id) REFERENCES lms_categories(company_id, id) ON DELETE SET NULL (category_id)
);
CREATE UNIQUE INDEX uq_lms_courses_code ON lms_courses(company_id, code) WHERE deleted_at IS NULL;
CREATE INDEX idx_lms_courses_company ON lms_courses(company_id, status) WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------
-- 5. Bài học
--   text: nội dung trong body; video: file (document_id) hoặc link (external_url);
--   document: file tài liệu; link: trang ngoài
-- ---------------------------------------------------------------------
CREATE TABLE lms_lessons (
    id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    company_id       bigint NOT NULL,
    course_id        bigint NOT NULL,
    title            varchar(255) NOT NULL,
    content_type     varchar(10) NOT NULL CHECK (content_type IN ('text', 'video', 'document', 'link')),
    body             text,
    external_url     varchar(1000),
    document_id      bigint,
    duration_minutes integer CHECK (duration_minutes >= 0),
    sort_order       integer NOT NULL DEFAULT 0,
    is_required      boolean NOT NULL DEFAULT true,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now(),
    UNIQUE (course_id, id),
    FOREIGN KEY (company_id, course_id) REFERENCES lms_courses(company_id, id) ON DELETE CASCADE,
    FOREIGN KEY (company_id, document_id) REFERENCES lms_documents(company_id, id),
    CHECK (content_type <> 'document' OR document_id IS NOT NULL),
    CHECK (content_type <> 'link' OR external_url IS NOT NULL),
    CHECK (content_type <> 'video' OR document_id IS NOT NULL OR external_url IS NOT NULL)
);
CREATE INDEX idx_lms_lessons_course ON lms_lessons(course_id, sort_order, id);
CREATE INDEX idx_lms_lessons_document ON lms_lessons(document_id) WHERE document_id IS NOT NULL;

-- Tài liệu tham khảo của khoá học
CREATE TABLE lms_course_documents (
    company_id  bigint NOT NULL,
    course_id   bigint NOT NULL,
    document_id bigint NOT NULL,
    sort_order  integer NOT NULL DEFAULT 0,
    PRIMARY KEY (course_id, document_id),
    FOREIGN KEY (company_id, course_id) REFERENCES lms_courses(company_id, id) ON DELETE CASCADE,
    FOREIGN KEY (company_id, document_id) REFERENCES lms_documents(company_id, id) ON DELETE CASCADE
);
CREATE INDEX idx_lms_course_documents_document ON lms_course_documents(document_id);

-- ---------------------------------------------------------------------
-- 6. Ghi danh / giao khoá học
--   progress_percent: % bài bắt buộc đã xong (không có bài bắt buộc thì tính mọi bài);
--   đã completed thì giữ nguyên kể cả khi khoá học thêm bài.
-- ---------------------------------------------------------------------
CREATE TABLE lms_enrollments (
    id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    company_id       bigint NOT NULL,
    course_id        bigint NOT NULL,
    user_id          bigint NOT NULL,
    source           varchar(10) NOT NULL DEFAULT 'assigned' CHECK (source IN ('assigned', 'self')),
    assigned_by      bigint REFERENCES users(id) ON DELETE SET NULL,
    due_date         date,
    status           varchar(15) NOT NULL DEFAULT 'not_started'
                     CHECK (status IN ('not_started', 'in_progress', 'completed')),
    progress_percent numeric(5, 2) NOT NULL DEFAULT 0 CHECK (progress_percent BETWEEN 0 AND 100),
    started_at       timestamptz,
    completed_at     timestamptz,
    last_accessed_at timestamptz,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now(),
    UNIQUE (course_id, user_id),
    UNIQUE (id, course_id),
    FOREIGN KEY (company_id, course_id) REFERENCES lms_courses(company_id, id) ON DELETE CASCADE,
    -- Nhân viên phải cùng công ty với khoá học (users UNIQUE (company_id, id) — revision 0008 project_manager)
    FOREIGN KEY (company_id, user_id) REFERENCES users(company_id, id) ON DELETE CASCADE,
    CHECK (status <> 'completed' OR completed_at IS NOT NULL)
);
CREATE INDEX idx_lms_enrollments_user ON lms_enrollments(user_id, status);
CREATE INDEX idx_lms_enrollments_company ON lms_enrollments(company_id, status, due_date);

-- Tiến độ từng bài học
CREATE TABLE lms_lesson_progress (
    enrollment_id         bigint NOT NULL,
    course_id             bigint NOT NULL,
    lesson_id             bigint NOT NULL,
    started_at            timestamptz NOT NULL DEFAULT now(),
    completed_at          timestamptz,
    last_position_seconds integer NOT NULL DEFAULT 0 CHECK (last_position_seconds >= 0),
    updated_at            timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (enrollment_id, lesson_id),
    FOREIGN KEY (enrollment_id, course_id) REFERENCES lms_enrollments(id, course_id) ON DELETE CASCADE,
    FOREIGN KEY (course_id, lesson_id) REFERENCES lms_lessons(course_id, id) ON DELETE CASCADE
);
CREATE INDEX idx_lms_lesson_progress_lesson ON lms_lesson_progress(lesson_id);

-- ---------------------------------------------------------------------
-- 7. Trigger: updated_at + audit (activity_logs của project_manager)
-- ---------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['lms_categories', 'lms_documents', 'lms_courses', 'lms_lessons',
                             'lms_enrollments', 'lms_lesson_progress']
    LOOP
        EXECUTE format('CREATE TRIGGER trg_%1$s_updated_at BEFORE UPDATE ON %1$I
                        FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at()', t);
    END LOOP;
    FOREACH t IN ARRAY ARRAY['lms_user_roles', 'lms_categories', 'lms_documents', 'lms_courses', 'lms_lessons',
                             'lms_enrollments']
    LOOP
        EXECUTE format('CREATE TRIGGER trg_%1$s_audit AFTER INSERT OR UPDATE OR DELETE ON %1$I
                        FOR EACH ROW EXECUTE FUNCTION fn_audit_log()', t);
    END LOOP;
END $$;
