from fastapi import APIRouter

from app.api.v1.endpoints import (
    auth,
    categories,
    companies,
    courses,
    documents,
    employees,
    enrollments,
    lessons,
    me,
)

api_router = APIRouter()
api_router.include_router(auth.router, prefix="/auth", tags=["Xác thực"])
api_router.include_router(companies.router, prefix="/companies", tags=["Doanh nghiệp"])
api_router.include_router(employees.lookup_router, prefix="/employees", tags=["Nhân viên"])
api_router.include_router(employees.router, prefix="/companies/{company_id}/employees", tags=["Nhân viên"])
api_router.include_router(categories.router, prefix="/categories", tags=["Danh mục"])
api_router.include_router(documents.router, prefix="/documents", tags=["Tài liệu"])
api_router.include_router(courses.router, prefix="/courses", tags=["Khoá học"])
api_router.include_router(lessons.router, prefix="/courses/{course_id}/lessons", tags=["Bài học"])
api_router.include_router(
    enrollments.course_router, prefix="/courses/{course_id}/enrollments", tags=["Ghi danh & tiến độ"]
)
api_router.include_router(enrollments.router, prefix="/enrollments", tags=["Ghi danh & tiến độ"])
api_router.include_router(enrollments.report_router, prefix="/reports", tags=["Báo cáo"])
api_router.include_router(me.router, prefix="/me", tags=["Học viên"])
