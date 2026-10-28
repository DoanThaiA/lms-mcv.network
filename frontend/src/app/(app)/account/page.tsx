"use client";

import { useMutation } from "@tanstack/react-query";
import { useState } from "react";

import { MetaBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { Avatar, Card, CardHeader, PageHeader } from "@/components/ui/misc";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { ROLE } from "@/lib/labels";
import { fmtDateTime } from "@/lib/utils";

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[140px_1fr] gap-3 py-2">
      <dt className="text-ink-3">{label}</dt>
      <dd className="min-w-0 break-words">{value || "—"}</dd>
    </div>
  );
}

export default function AccountPage() {
  const { me } = useAuth();
  const toast = useToast();
  const [form, setForm] = useState({ current: "", next: "", confirm: "" });

  const change = useMutation({
    mutationFn: () => api.post("/auth/change-password", { current_password: form.current, new_password: form.next }),
    onSuccess: () => {
      toast.success("Đã đổi mật khẩu (áp dụng cả Project Manager)");
      setForm({ current: "", next: "", confirm: "" });
    },
    onError: toast.error,
  });

  if (!me) return null;
  const mismatch = form.confirm.length > 0 && form.confirm !== form.next;
  const valid = form.current && form.next.length >= 8 && form.next === form.confirm;

  return (
    <>
      <PageHeader title="Tài khoản của tôi" />
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Thông tin" />
          <div className="px-4 py-3">
            <div className="mb-3 flex items-center gap-3">
              <Avatar name={me.user.full_name} id={me.user.id} />
              <div>
                <p className="font-semibold">{me.user.full_name}</p>
                <p className="text-ink-3">{me.user.job_title}</p>
              </div>
              <span className="ml-auto">
                {me.is_system_admin ? (
                  <MetaBadge meta={{ label: "Quản trị hệ thống", tone: "red" }} />
                ) : (
                  <MetaBadge meta={ROLE[me.role]} />
                )}
              </span>
            </div>
            <dl className="divide-y divide-line">
              <InfoRow label="Công ty" value={`${me.company.code} · ${me.company.name}`} />
              <InfoRow label="Mã nhân viên" value={me.user.employee_code} />
              <InfoRow label="Tên đăng nhập PM" value={me.user.username} />
              <InfoRow label="Email" value={me.user.email} />
              <InfoRow label="Điện thoại" value={me.user.phone} />
              <InfoRow label="Đăng nhập gần nhất" value={fmtDateTime(me.user.last_login_at)} />
            </dl>
          </div>
        </Card>

        <Card>
          <CardHeader title="Đổi mật khẩu" />
          <form
            className="space-y-4 px-4 py-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (valid) change.mutate();
            }}
          >
            <Field label="Mật khẩu hiện tại" required>
              {(id) => (
                <Input
                  id={id}
                  type="password"
                  autoComplete="current-password"
                  value={form.current}
                  onChange={(e) => setForm({ ...form, current: e.target.value })}
                />
              )}
            </Field>
            <Field label="Mật khẩu mới" required hint="Tối thiểu 8 ký tự; dùng chung với Project Manager">
              {(id) => (
                <Input
                  id={id}
                  type="password"
                  autoComplete="new-password"
                  value={form.next}
                  onChange={(e) => setForm({ ...form, next: e.target.value })}
                />
              )}
            </Field>
            <Field label="Nhập lại mật khẩu mới" required hint={mismatch ? "Mật khẩu nhập lại không khớp" : undefined}>
              {(id) => (
                <Input
                  id={id}
                  type="password"
                  autoComplete="new-password"
                  aria-invalid={mismatch}
                  value={form.confirm}
                  onChange={(e) => setForm({ ...form, confirm: e.target.value })}
                />
              )}
            </Field>
            <Button type="submit" variant="primary" loading={change.isPending} disabled={!valid}>
              Đổi mật khẩu
            </Button>
          </form>
        </Card>
      </div>
    </>
  );
}
