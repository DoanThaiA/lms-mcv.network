import { Suspense } from "react";

import { Spinner } from "@/components/ui/misc";

// Layout server: Suspense cho phần client đọc params, để Next render được khung trang ngay khi điều hướng
export default function CourseLayout({ children }: LayoutProps<"/courses/[id]">) {
  return <Suspense fallback={<Spinner />}>{children}</Suspense>;
}
