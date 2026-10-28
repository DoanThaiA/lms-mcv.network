"use client";

import { GraduationCap } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";

// Nhớ mã công ty trên máy này để lần sau chỉ cần nhập mã nhân viên + mật khẩu
const COMPANY_KEY = "lms_company_code";

function storedCompany() {
  try {
    return localStorage.getItem(COMPANY_KEY) ?? "";
  } catch {
    return "";
  }
}

export default function LoginPage() {
  const { login, token, ready } = useAuth();
  const router = useRouter();
  const next = useSearchParams().get("next") || "/";
  const [company, setCompany] = useState<string | null>(null);
  const [employee, setEmployee] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const companyCode = company ?? (ready ? storedCompany() : "");

  useEffect(() => {
    if (ready && token) router.replace(next);
  }, [ready, token, next, router]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login({ company_code: companyCode.trim(), employee_code: employee.trim(), password });
      try {
        localStorage.setItem(COMPANY_KEY, companyCode.trim());
      } catch {
        /* ignore */
      }
      router.replace(next);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-2.5">
          <span className="flex size-9 items-center justify-center rounded-lg bg-brand text-white">
            <GraduationCap className="size-5" />
          </span>
          <div>
            <p className="font-semibold">LMS doanh nghiệp</p>
            <p className="text-xs text-ink-3">Khoá học & tài liệu đào tạo nội bộ</p>
          </div>
        </div>

        <form onSubmit={onSubmit} className="space-y-4 rounded-xl border border-line bg-surface p-6 shadow-card" noValidate>
          <h1 className="text-lg font-semibold">Đăng nhập</h1>
          <Field label="Mã công ty">
            {(id) => (
              <Input
                id={id}
                autoComplete="organization"
                autoFocus={!companyCode}
                required
                value={companyCode}
                onChange={(e) => setCompany(e.target.value)}
                placeholder="VD: MCV"
                className="uppercase placeholder:normal-case"
              />
            )}
          </Field>
          <Field label="Mã nhân viên">
            {(id) => (
              <Input
                id={id}
                autoComplete="username"
                autoFocus={!!companyCode}
                required
                value={employee}
                onChange={(e) => setEmployee(e.target.value)}
                placeholder="VD: NV001"
                className="uppercase placeholder:normal-case"
              />
            )}
          </Field>
          <Field label="Mật khẩu">
            {(id) => (
              <Input
                id={id}
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            )}
          </Field>
          {error && (
            <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
              {error}
            </p>
          )}
          <Button
            type="submit"
            variant="primary"
            className="w-full"
            loading={submitting}
            disabled={!companyCode.trim() || !employee.trim() || !password}
          >
            Đăng nhập
          </Button>
        </form>
        <p className="mt-4 text-center text-xs text-ink-3">
          Dùng chung mật khẩu với Project Manager. Quên mật khẩu: liên hệ quản trị LMS của công ty.
        </p>
      </div>
    </main>
  );
}
