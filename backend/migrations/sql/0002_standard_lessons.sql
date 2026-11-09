-- =====================================================================
-- Bài học chuẩn (revision 0002): một bài gồm Mục tiêu · Video · Nội dung · Câu hỏi kiểm tra ·
-- Tài liệu thực hành · Nộp bài, theo mẫu "AI thực chiến – Phòng Kinh doanh".
--   lesson_kind: theory   = lý thuyết (xem hết video + đọc hết nội dung)
--                quiz     = lý thuyết + kiểm tra (xem hết video + trả lời đạt câu hỏi)
--                practice = thực hành (nộp bài: link / file / nội dung)
-- =====================================================================

ALTER TABLE lms_lessons DROP CONSTRAINT lms_lessons_content_type_check;
ALTER TABLE lms_lessons ADD CONSTRAINT lms_lessons_content_type_check
    CHECK (content_type IN ('text', 'video', 'document', 'link', 'standard'));

ALTER TABLE lms_lessons
    ADD COLUMN lesson_kind   varchar(10) CHECK (lesson_kind IN ('theory', 'quiz', 'practice')),
    ADD COLUMN goals         jsonb NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN video_minutes integer CHECK (video_minutes >= 0),
    ADD COLUMN quiz          jsonb,
    ADD COLUMN assignment    jsonb,
    ADD CONSTRAINT lms_lessons_standard_kind_check CHECK (content_type <> 'standard' OR lesson_kind IS NOT NULL),
    ADD CONSTRAINT lms_lessons_quiz_check CHECK (lesson_kind IS DISTINCT FROM 'quiz' OR quiz IS NOT NULL),
    ADD CONSTRAINT lms_lessons_assignment_check
        CHECK (lesson_kind IS DISTINCT FROM 'practice' OR assignment IS NOT NULL);
COMMENT ON COLUMN lms_lessons.goals IS 'Mục tiêu bài học: ["...", ...]';
COMMENT ON COLUMN lms_lessons.video_minutes IS 'Thời lượng video (phút): video nhúng YouTube/Vimeo cần mở đủ 90% mới tính đã xem';
COMMENT ON COLUMN lms_lessons.quiz IS '{"pass_score": n | null (null = đúng tất cả), "questions": [{"question", "options": [...], "answer": i, "explanation"}]}';
COMMENT ON COLUMN lms_lessons.assignment IS '{"requirement": "...", "criteria": [...], "allow_text": bool}';

-- Tài liệu thực hành của bài học (file trong thư viện)
CREATE TABLE lms_lesson_documents (
    company_id  bigint NOT NULL,
    lesson_id   bigint NOT NULL REFERENCES lms_lessons(id) ON DELETE CASCADE,
    document_id bigint NOT NULL,
    sort_order  integer NOT NULL DEFAULT 0,
    PRIMARY KEY (lesson_id, document_id),
    FOREIGN KEY (company_id, document_id) REFERENCES lms_documents(company_id, id)
);
CREATE INDEX idx_lms_lesson_documents_document ON lms_lesson_documents(document_id);

-- Tiến độ: đã xem hết video, kết quả câu hỏi kiểm tra
ALTER TABLE lms_lesson_progress
    ADD COLUMN video_completed_at timestamptz,
    ADD COLUMN quiz_attempts      integer NOT NULL DEFAULT 0 CHECK (quiz_attempts >= 0),
    ADD COLUMN quiz_score         integer CHECK (quiz_score >= 0),
    ADD COLUMN quiz_passed_at     timestamptz;
COMMENT ON COLUMN lms_lesson_progress.last_position_seconds IS
    'Video file: vị trí đang xem; video nhúng (bài chuẩn): số giây đã mở video';

-- Bài nộp của bài thực hành; giảng viên chấm đạt / chưa đạt
CREATE TABLE lms_lesson_submissions (
    id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    company_id    bigint NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    enrollment_id bigint NOT NULL,
    course_id     bigint NOT NULL,
    lesson_id     bigint NOT NULL,
    link          varchar(1000),
    note          text,
    files         jsonb NOT NULL DEFAULT '[]'::jsonb,  -- [{"file_name", "storage_key", "size_bytes"}]
    review_status varchar(10) NOT NULL DEFAULT 'pending' CHECK (review_status IN ('pending', 'passed', 'failed')),
    review_note   text,
    reviewed_by   bigint REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at   timestamptz,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (enrollment_id, course_id) REFERENCES lms_enrollments(id, course_id) ON DELETE CASCADE,
    FOREIGN KEY (course_id, lesson_id) REFERENCES lms_lessons(course_id, id) ON DELETE CASCADE
);
CREATE INDEX idx_lms_lesson_submissions_enrollment ON lms_lesson_submissions(enrollment_id, lesson_id, created_at);
CREATE INDEX idx_lms_lesson_submissions_lesson ON lms_lesson_submissions(lesson_id, review_status);

CREATE TRIGGER trg_lms_lesson_submissions_updated_at BEFORE UPDATE ON lms_lesson_submissions
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();
