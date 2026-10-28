# LMS MCV

Hệ thống quản lý khoá học, tài liệu đào tạo theo doanh nghiệp. Mỗi doanh nghiệp có nhiều nhân viên, mỗi nhân viên một
tài khoản; **đăng nhập bằng mã công ty + mã nhân viên + mật khẩu**.

```
backend/     API FastAPI + SQLAlchemy 2 async; migration Alembic ở backend/migrations
frontend/    Giao diện Next.js 16 + Tailwind 4 + TanStack Query (cùng bộ UI với Project Manager)
db/seeds/    Dữ liệu mẫu cho dev
docs/        Thiết kế database
scripts/     Khởi tạo database
```

## Database: dùng chung với project_manager

Không có database riêng: LMS dùng **database `project_manager`** (user `pm_user`) trên PostgreSQL của `ai_carbon_analyst`.

- Bảng nhân viên là `users` của project_manager — nhân viên dùng một tài khoản, một mật khẩu cho cả hai hệ thống.
- Bảng `companies` và cột `users.company_id` / `users.employee_code` thêm bằng **migration 0008 của project_manager**
  (`project_manager/backend/migrations/versions/0008_companies_employees.py`).
- Bảng riêng của LMS có tiền tố `lms_`, do Alembic của repo này quản lý, phiên bản lưu ở `alembic_version_lms`
  (không đụng `alembic_version` của project_manager).

Chi tiết: [docs/DATABASE.md](docs/DATABASE.md)

Khởi tạo lần đầu (cần `carbon_analyst_db` đang chạy, project_manager đã migration tới 0008):

```bash
cp .env.example .env            # PM_DB_PASSWORD (giống project_manager), LMS_SECRET_KEY (giá trị ngẫu nhiên mới)
./scripts/init_db.sh --demo     # migration LMS (+ dữ liệu mẫu công ty DEMO, mật khẩu Demo@123)
```

Tạo doanh nghiệp và quản trị viên đầu tiên (production):

```bash
docker compose exec api python -m app.cli create-company --code MCV --name "Công ty ..."
# gán tài khoản đang có (vd quản trị Project Manager) làm quản trị LMS, giữ nguyên mật khẩu
docker compose exec api python -m app.cli link-employee --company MCV --username admin --employee-code NV001 --role admin
# hoặc tạo nhân viên mới (hỏi mật khẩu)
docker compose exec api python -m app.cli create-employee --company MCV --employee-code NV002 \
    --full-name "Nguyễn Văn A" --email a@congty.vn --role admin
```

Tài khoản mẫu (mã công ty `DEMO`, mật khẩu `Demo@123`):

| Mã NV | Vai trò |
|---|---|
| `NV000` | Quản trị hệ thống (quản lý mọi doanh nghiệp) |
| `NV001` | Quản trị LMS |
| `NV002` | Giảng viên |
| `NV003`, `NV004` | Học viên |

Công ty `KHAC` / `NV001`: học viên công ty khác (kiểm tra tách dữ liệu). Tài khoản `pm.only` chưa thuộc công ty nào
(thử chức năng "Gán tài khoản có sẵn").

## Lưu file trên Cloudflare R2

Tài liệu và video bài học lưu trên Cloudflare R2 (bucket private). **Trình duyệt tải file thẳng lên R2** bằng URL ký
tạm (`POST /documents/upload-url` → PUT lên R2 → `POST /documents/complete`), file lớn không đi qua API. Xem / tải về
cũng qua URL ký tạm hết hạn sau 1 giờ; video phát trực tiếp từ R2 (tua được). Tối đa `FILE_MAX_MB` (mặc định 2 GB).

1. Cloudflare Dashboard › **R2** › **Create bucket** (vd `lms`), để **private**. Ghi lại **Account ID**.
   Dùng chung bucket với project_manager cũng được: file LMS nằm dưới tiền tố `lms/` (`R2_KEY_PREFIX`).
2. **R2 › Manage R2 API Tokens › Create API token**: quyền **Object Read & Write**, chỉ bucket ở bước 1.
   Copy **Access Key ID**, **Secret Access Key**.
3. Bucket › **Settings › CORS policy** — cho phép trình duyệt PUT / xem file từ địa chỉ giao diện:

   ```json
   [
     {
       "AllowedOrigins": ["http://localhost:3001", "https://lms.congty.vn"],
       "AllowedMethods": ["GET", "HEAD", "PUT"],
       "AllowedHeaders": ["content-type"],
       "ExposeHeaders": ["ETag"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```

   Chưa bật CORS: file ≤ 100 MB tự chuyển sang tải qua API (`POST /documents`), file lớn hơn báo lỗi.
4. Điền `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` (bucket vùng EU thêm `R2_ENDPOINT`)
   vào `.env`, rồi kiểm tra: `docker compose exec api python -m app.cli check-storage`
   (khi dev: `cd backend && uv run python -m app.cli check-storage`).

## Chạy bằng Docker

```bash
docker compose up -d --build
```

- Giao diện: http://localhost:3001
- API: http://localhost:8001 · Swagger: http://localhost:8001/docs (bấm Authorize, dán token từ `POST /auth/login`)

## Chạy backend khi phát triển

```bash
cd backend
cp .env.example .env    # điền mật khẩu pm_user vào DATABASE_URL
uv sync
uv run alembic upgrade head   # áp migration LMS lên database dev (sau migration project_manager)
uv run uvicorn app.main:app --reload --port 8001
uv run pytest           # tạo lại DB lms_test: migration project_manager (../project_manager/backend) + LMS + seed
uvx ruff check app tests migrations
```

Test cần repo project_manager cạnh repo này (đổi bằng `PM_BACKEND_DIR`). Có chốt chặn không chạy trên DB dev.

## Chạy frontend khi phát triển

```bash
cd frontend
npm install
npm run dev                # http://localhost:3001, gọi API qua rewrite /api -> BACKEND_URL (mặc định :8001)
npx tsc --noEmit && npm run lint
```

Chạy phía client sau đăng nhập (JWT trong localStorage, khoá `lms_token`; mã công ty nhớ trên máy để lần sau chỉ
nhập mã nhân viên). Menu / nút ẩn hiện theo `permissions` trong `/auth/me`; backend vẫn kiểm tra lại mọi quyền.

| Trang | Chức năng |
|---|---|
| `/login` | Đăng nhập: mã công ty + mã nhân viên + mật khẩu |
| `/` | Tổng quan: thống kê khoá học của tôi, tiếp tục học, khoá mở đăng ký; người quản lý thấy thêm số liệu đào tạo công ty |
| `/my-courses` | Khoá học của tôi theo trạng thái (chưa học / đang học / hoàn thành / quá hạn) |
| `/courses` | Danh mục khoá học (lưới / bảng), lọc danh mục, trạng thái, hình thức ghi danh; tạo khoá học |
| `/courses/[id]` | Chi tiết: đăng ký khoá mở, tiến độ; người soạn: sửa, phát hành / lưu trữ / về nháp, xoá, thêm / sửa / xoá / sắp xếp bài, tài liệu tham khảo; tab Học viên: giao khoá học, đổi hạn, huỷ ghi danh, xem tiến độ từng bài |
| `/courses/[id]/learn/[lessonId]` | Học bài: bài đọc, video (file: nhớ vị trí xem, xem hết tự hoàn thành; YouTube / Vimeo nhúng), tài liệu xem trực tiếp (PDF, ảnh, Office), link; đánh dấu hoàn thành, bài trước / sau |
| `/documents` | Thư viện tài liệu: tìm, lọc, xem trước, tải về; tải lên (kéo thả), sửa, xoá |
| `/enrollments` | Ghi danh & tiến độ toàn công ty, lọc khoá học / trạng thái / quá hạn (nhận bộ lọc từ URL) |
| `/reports` | Báo cáo theo khoá học, xuất CSV |
| `/admin/categories` | Danh mục khoá học / tài liệu |
| `/admin/employees` | Nhân viên: tạo, sửa, vai trò, đặt lại mật khẩu, khoá / mở khoá, gỡ khỏi công ty; quản trị hệ thống chọn công ty và gán tài khoản có sẵn |
| `/admin/companies` | Doanh nghiệp (quản trị hệ thống) |
| `/account` | Thông tin tài khoản, đổi mật khẩu |

## Vai trò & quyền

| Vai trò | Quyền |
|---|---|
| Quản trị hệ thống (`users.is_system_admin`) | Mọi quyền + quản lý doanh nghiệp, nhân viên mọi công ty, gán tài khoản có sẵn vào công ty |
| `admin` | Nhân viên công ty mình, nội dung, giao khoá học, báo cáo |
| `instructor` | Nội dung (danh mục, tài liệu, khoá học, bài học), giao khoá học, báo cáo |
| `learner` (mặc định) | Học khoá được giao / tự đăng ký khoá mở, xem tài liệu được phép |

## API (`/api/v1`)

JWT Bearer: `POST /auth/login` với JSON `{"company_code", "employee_code", "password"}`. Token LMS ký bằng khoá riêng
(`aud=lms`), không dùng lẫn với token Project Manager.

| Nhóm | Endpoint |
|---|---|
| Xác thực | `POST /auth/login`, `GET /auth/me`, `POST /auth/change-password` |
| Doanh nghiệp | `GET/POST /companies`, `GET/PATCH/DELETE /companies/{id}` |
| Nhân viên | `GET /employees/lookup` (chọn người giao khoá học), `GET /employees/unassigned` (tài khoản chưa thuộc công ty), `GET/POST /companies/{cid}/employees`, `POST …/link`, `GET/PATCH/DELETE …/{uid}`, `PUT …/{uid}/role`, `POST …/{uid}/reset-password` |
| Danh mục | `GET/POST /categories`, `PATCH/DELETE /categories/{id}` |
| Tài liệu | `POST /documents/upload-url` + `POST /documents/complete` (tải thẳng lên R2), `GET/POST(multipart) /documents`, `GET/PATCH/DELETE /documents/{id}` (link tải / xem trước ký tạm 1 giờ) |
| Khoá học | `GET/POST /courses`, `GET/PATCH/DELETE /courses/{id}`, `POST /courses/{id}/status`, `PUT /courses/{id}/documents` |
| Bài học | `POST /courses/{id}/lessons`, `GET/PATCH/DELETE …/{lid}`, `PUT /courses/{id}/lessons/order` |
| Ghi danh | `POST /courses/{id}/enrollments` (giao nhiều người), `GET /enrollments`, `GET …/{eid}/progress`, `PATCH/DELETE /enrollments/{eid}` |
| Báo cáo | `GET /reports/courses` |
| Học viên | `GET /me/courses`, `POST /me/courses/{id}/enroll`, `GET /me/courses/{id}/progress`, `POST /me/courses/{id}/lessons/{lid}/progress` |

### Quy tắc nghiệp vụ chính

- Đăng nhập: mã công ty / mã nhân viên không phân biệt hoa thường; sai quá 5 lần trong 15 phút thì tạm khoá
  (`LOGIN_MAX_FAILURES`, `LOGIN_LOCK_MINUTES`). Công ty `inactive` hoặc tài khoản bị khoá không đăng nhập được.
  Token cũ mất hiệu lực khi nhân viên bị chuyển khỏi công ty.
- Khoá học phải có ít nhất 1 bài mới phát hành; chỉ giao được khoá đang phát hành; đã có người ghi danh thì không
  về nháp được (chỉ lưu trữ); khoá đang phát hành phải lưu trữ trước khi xoá.
- Học viên chỉ thấy khoá đã phát hành mở đăng ký hoặc khoá mình được giao; phải ghi danh mới mở được nội dung bài.
  Nhân viên công ty khác nhận 404.
- Tài liệu `course` chỉ học viên của khoá học có dùng tài liệu mới xem được; tài liệu đang dùng trong bài học không xoá được.
# lms-mcv.network
