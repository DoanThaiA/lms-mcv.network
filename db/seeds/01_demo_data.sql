-- =====================================================================
-- Dữ liệu mẫu LMS (chỉ dùng cho dev / test). Chạy sau migration project_manager (0008) + LMS.
-- Mật khẩu mọi tài khoản mẫu: Demo@123
--   Công ty DEMO: NV000 (quản trị hệ thống: quản lý mọi doanh nghiệp), NV001 (admin LMS), NV002 (instructor), NV003, NV004 (learner)
--   Công ty KHAC: NV001 (learner) — kiểm tra tách dữ liệu giữa các công ty
-- =====================================================================
BEGIN;

INSERT INTO companies (code, name, short_name) VALUES
    ('DEMO', 'Công ty TNHH Demo', 'Demo'),
    ('KHAC', 'Công ty Cổ phần Khác', 'Khác');

INSERT INTO users (username, email, password_hash, full_name, job_title, company_id, employee_code, is_system_admin)
SELECT v.username, v.email, '$2b$12$YGiQugEJQF0HR7Mcd1QLbuFlDkPw2oPSXrert.CMuISbK3A2JLXWi', v.full_name, v.job_title,
       c.id, v.employee_code, v.employee_code = 'NV000' AND v.company = 'DEMO'
  FROM (VALUES
        ('DEMO', 'demo.nv000', 'nv000@demo.vn', 'Quản Trị Hệ Thống', 'Quản trị hệ thống',   'NV000'),
        ('DEMO', 'demo.nv001', 'nv001@demo.vn', 'Trần Quản Trị', 'Trưởng phòng nhân sự', 'NV001'),
        ('DEMO', 'demo.nv002', 'nv002@demo.vn', 'Lê Giảng Viên', 'Chuyên viên đào tạo',  'NV002'),
        ('DEMO', 'demo.nv003', 'nv003@demo.vn', 'Phạm Học Viên', 'Nhân viên kinh doanh', 'NV003'),
        ('DEMO', 'demo.nv004', 'nv004@demo.vn', 'Hoàng Thị Bốn', 'Nhân viên kế toán',   'NV004'),
        ('KHAC', 'khac.nv001', 'nv001@khac.vn', 'Ngô Công Ty Khác', 'Nhân viên',         'NV001')
       ) AS v(company, username, email, full_name, job_title, employee_code)
  JOIN companies c ON c.code = v.company;

-- Tài khoản chưa thuộc công ty nào (như tài khoản Project Manager có sẵn) để thử chức năng "gán tài khoản có sẵn"
INSERT INTO users (username, email, password_hash, full_name, job_title) VALUES
    ('pm.only', 'pm.only@example.com', '$2b$12$YGiQugEJQF0HR7Mcd1QLbuFlDkPw2oPSXrert.CMuISbK3A2JLXWi', 'Người Dùng PM', 'Developer');

INSERT INTO lms_user_roles (user_id, role)
SELECT id, 'admin' FROM users WHERE username = 'demo.nv001'
UNION ALL
SELECT id, 'instructor' FROM users WHERE username = 'demo.nv002';

INSERT INTO lms_categories (company_id, name, sort_order)
SELECT id, v.name, v.sort_order FROM companies, (VALUES ('Hội nhập', 1), ('An toàn thông tin', 2)) AS v(name, sort_order)
 WHERE code = 'DEMO';

COMMIT;
