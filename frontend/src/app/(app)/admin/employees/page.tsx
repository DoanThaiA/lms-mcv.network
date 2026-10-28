"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Link2, Lock, LockOpen, Pencil, Plus, Search, UserMinus } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useDeferredValue, useState } from "react";

import { MetaBadge } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";
import { Avatar, Card, Empty, PageHeader, Pagination, Spinner, Table } from "@/components/ui/misc";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { api, clean } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { ROLE, USER_STATUS } from "@/lib/labels";
import type { Company, Employee, EmployeeDetail, LmsRole, Page, UserStatus } from "@/lib/types";
import { cn, fmtRelative } from "@/lib/utils";

const SIZE = 50;
const CODE_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,29}$/;
const USERNAME_RE = /^[a-z0-9][a-z0-9_.-]{2,49}$/;
const ROLES = Object.keys(ROLE) as LmsRole[];

function RoleSelect({ id, value, onChange }: { id?: string; value: LmsRole; onChange: (r: LmsRole) => void }) {
  return (
    <Select id={id} value={value} onChange={(e) => onChange(e.target.value as LmsRole)}>
      {ROLES.map((r) => (
        <option key={r} value={r}>
          {ROLE[r].label} — {ROLE[r].description}
        </option>
      ))}
    </Select>
  );
}

function EmployeeModal({
  base,
  employee,
  companyCode,
  onClose,
}: {
  base: string;
  employee?: EmployeeDetail;
  companyCode: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const { me } = useAuth();
  const editing = !!employee;
  const isSelf = employee?.id === me?.user.id;
  const [form, setForm] = useState({
    employee_code: employee?.employee_code ?? "",
    full_name: employee?.full_name ?? "",
    email: employee?.email ?? "",
    password: "",
    username: "",
    phone: employee?.phone ?? "",
    job_title: employee?.job_title ?? "",
    role: employee?.role ?? ("learner" as LmsRole),
  });
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  const save = useMutation({
    mutationFn: async () => {
      const profile = {
        employee_code: form.employee_code.trim(),
        full_name: form.full_name.trim(),
        email: form.email.trim(),
        phone: form.phone.trim() || null,
        job_title: form.job_title.trim() || null,
      };
      if (!editing) {
        return api.post(base, {
          ...profile,
          password: form.password,
          username: form.username.trim() || null,
          role: form.role,
        });
      }
      await api.patch(`${base}/${employee.id}`, profile);
      if (form.role !== employee.role) await api.put(`${base}/${employee.id}/role`, { role: form.role });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["employees"] });
      toast.success(editing ? "Đã lưu nhân viên" : "Đã tạo tài khoản nhân viên");
      onClose();
    },
    onError: toast.error,
  });

  const valid =
    CODE_RE.test(form.employee_code.trim()) &&
    form.full_name.trim() &&
    form.email.includes("@") &&
    (editing || (form.password.length >= 8 && (!form.username || USERNAME_RE.test(form.username.trim()))));

  return (
    <Modal
      open
      size="lg"
      onClose={onClose}
      title={editing ? `Sửa ${employee.full_name}` : "Nhân viên mới"}
      description={editing ? `Tên đăng nhập Project Manager: ${employee.username}` : `Công ty ${companyCode}`}
      footer={
        <>
          <Button onClick={onClose}>Huỷ</Button>
          <Button variant="primary" loading={save.isPending} disabled={!valid} onClick={() => save.mutate()}>
            Lưu
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Mã nhân viên" required hint="Dùng để đăng nhập LMS">
          {(id) => <Input id={id} value={form.employee_code} onChange={(e) => set("employee_code", e.target.value)} />}
        </Field>
        <Field label="Họ tên" required>
          {(id) => <Input id={id} value={form.full_name} onChange={(e) => set("full_name", e.target.value)} />}
        </Field>
        <Field label="Email" required>
          {(id) => <Input id={id} type="email" value={form.email} onChange={(e) => set("email", e.target.value)} />}
        </Field>
        <Field label="Điện thoại">
          {(id) => <Input id={id} value={form.phone} onChange={(e) => set("phone", e.target.value)} />}
        </Field>
        <Field label="Chức danh">
          {(id) => <Input id={id} value={form.job_title} onChange={(e) => set("job_title", e.target.value)} />}
        </Field>
        {!editing && (
          <Field label="Mật khẩu ban đầu" required hint="Tối thiểu 8 ký tự">
            {(id) => (
              <Input
                id={id}
                type="password"
                autoComplete="new-password"
                value={form.password}
                onChange={(e) => set("password", e.target.value)}
              />
            )}
          </Field>
        )}
        {!editing && (
          <Field
            label="Tên đăng nhập Project Manager"
            hint={`Bỏ trống = ${(companyCode + "." + (form.employee_code || "<mã NV>")).toLowerCase()}`}
          >
            {(id) => <Input id={id} value={form.username} onChange={(e) => set("username", e.target.value.toLowerCase())} />}
          </Field>
        )}
        <Field label="Vai trò LMS" className="sm:col-span-2" hint={isSelf ? "Không tự đổi vai trò của mình" : undefined}>
          {(id) =>
            isSelf ? (
              <Input id={id} disabled value={ROLE[form.role].label} />
            ) : (
              <RoleSelect id={id} value={form.role} onChange={(r) => set("role", r)} />
            )
          }
        </Field>
      </div>
    </Modal>
  );
}

function ResetPasswordModal({ base, employee, onClose }: { base: string; employee: EmployeeDetail; onClose: () => void }) {
  const toast = useToast();
  const [password, setPassword] = useState("");
  const reset = useMutation({
    mutationFn: () => api.post(`${base}/${employee.id}/reset-password`, { new_password: password }),
    onSuccess: () => {
      toast.success(`Đã đặt lại mật khẩu cho ${employee.full_name}`);
      onClose();
    },
    onError: toast.error,
  });
  return (
    <Modal
      open
      size="sm"
      onClose={onClose}
      title="Đặt lại mật khẩu"
      description={`${employee.employee_code} · ${employee.full_name} (dùng chung Project Manager)`}
      footer={
        <>
          <Button onClick={onClose}>Huỷ</Button>
          <Button variant="primary" loading={reset.isPending} disabled={password.length < 8} onClick={() => reset.mutate()}>
            Đặt lại
          </Button>
        </>
      }
    >
      <Field label="Mật khẩu mới" hint="Tối thiểu 8 ký tự">
        {(id) => (
          <Input id={id} type="text" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} />
        )}
      </Field>
    </Modal>
  );
}

function LinkUserModal({ base, onClose }: { base: string; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [q, setQ] = useState("");
  const [userId, setUserId] = useState<number | null>(null);
  const [code, setCode] = useState("");
  const [role, setRole] = useState<LmsRole>("learner");
  const search = useDeferredValue(q);
  const users = useQuery({
    queryKey: ["employees", "unassigned", search],
    queryFn: async () => (await api.get<Employee[]>("/employees/unassigned", { params: clean({ q: search }) })).data,
  });
  const link = useMutation({
    mutationFn: () => api.post(`${base}/link`, { user_id: userId, employee_code: code.trim(), role }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["employees"] });
      toast.success("Đã gán tài khoản vào công ty");
      onClose();
    },
    onError: toast.error,
  });

  return (
    <Modal
      open
      size="lg"
      onClose={onClose}
      title="Gán tài khoản có sẵn"
      description="Tài khoản Project Manager chưa thuộc công ty nào; giữ nguyên mật khẩu"
      footer={
        <>
          <Button onClick={onClose}>Huỷ</Button>
          <Button
            variant="primary"
            loading={link.isPending}
            disabled={!userId || !CODE_RE.test(code.trim())}
            onClick={() => link.mutate()}
          >
            Gán vào công ty
          </Button>
        </>
      }
    >
      <div className="relative mb-3">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3" />
        <Input
          aria-label="Tìm tài khoản"
          placeholder="Username, họ tên, email"
          className="pl-9"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      {users.isPending ? (
        <Spinner />
      ) : !users.data?.length ? (
        <p className="py-6 text-center text-ink-3">Không có tài khoản nào chưa thuộc công ty</p>
      ) : (
        <ul className="mb-4 max-h-64 divide-y divide-line overflow-y-auto rounded-lg border border-line">
          {users.data.map((u) => (
            <li key={u.id}>
              <label className={cn("flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-subtle", userId === u.id && "bg-brand-soft/60")}>
                <input type="radio" name="user" className="accent-brand" checked={userId === u.id} onChange={() => setUserId(u.id)} />
                <Avatar name={u.full_name} id={u.id} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{u.full_name}</span>
                  <span className="block truncate text-xs text-ink-3">
                    {u.username} · {u.email}
                  </span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Mã nhân viên" required>
          {(id) => <Input id={id} value={code} onChange={(e) => setCode(e.target.value)} />}
        </Field>
        <Field label="Vai trò LMS">{(id) => <RoleSelect id={id} value={role} onChange={setRole} />}</Field>
      </div>
    </Modal>
  );
}

export default function EmployeesPage() {
  const { me, can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const isSystemAdmin = can("company.manage");
  const initialCompany = Number(useSearchParams().get("company")) || me!.company.id;
  const [companyId, setCompanyId] = useState(initialCompany);
  const [q, setQ] = useState("");
  const [role, setRole] = useState<LmsRole | "">("");
  const [status, setStatus] = useState<UserStatus | "">("");
  const [page, setPage] = useState(1);
  const [modal, setModal] = useState<
    | { kind: "create" }
    | { kind: "edit"; employee: EmployeeDetail }
    | { kind: "password"; employee: EmployeeDetail }
    | { kind: "link" }
    | null
  >(null);
  const search = useDeferredValue(q);
  const base = `/companies/${companyId}/employees`;

  const companies = useQuery({
    queryKey: ["companies", "all"],
    queryFn: async () => (await api.get<Page<Company>>("/companies", { params: { size: 100 } })).data.items,
    enabled: isSystemAdmin,
  });
  const company = companies.data?.find((c) => c.id === companyId) ?? (companyId === me!.company.id ? me!.company : undefined);

  const params = clean({ q: search, role, status, page, size: SIZE });
  const query = useQuery({
    queryKey: ["employees", companyId, params],
    queryFn: async () => (await api.get<Page<EmployeeDetail>>(base, { params })).data,
    placeholderData: keepPreviousData,
  });

  const update = useMutation({
    mutationFn: ({ e, status }: { e: EmployeeDetail; status: UserStatus }) => api.patch(`${base}/${e.id}`, { status }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["employees"] });
      toast.success("Đã cập nhật trạng thái");
    },
    onError: toast.error,
  });
  const remove = useMutation({
    mutationFn: (e: EmployeeDetail) => api.delete(`${base}/${e.id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["employees"] });
      qc.invalidateQueries({ queryKey: ["enrollments"] });
      toast.success("Đã gỡ nhân viên khỏi công ty");
    },
    onError: toast.error,
  });

  return (
    <>
      <PageHeader
        title="Nhân viên"
        description={company ? `${company.code} · ${company.name}` : undefined}
        actions={
          <>
            {isSystemAdmin && (
              <Button icon={<Link2 className="size-4" />} onClick={() => setModal({ kind: "link" })}>
                Gán tài khoản có sẵn
              </Button>
            )}
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setModal({ kind: "create" })}>
              Nhân viên mới
            </Button>
          </>
        }
      />

      <div className="mb-4 flex flex-wrap gap-2">
        {isSystemAdmin && (
          <Select
            aria-label="Công ty"
            className="w-auto max-w-72"
            value={companyId}
            onChange={(e) => {
              setCompanyId(Number(e.target.value));
              setPage(1);
            }}
          >
            {(companies.data ?? [me!.company]).map((c) => (
              <option key={c.id} value={c.id}>
                {c.code} · {c.name}
              </option>
            ))}
          </Select>
        )}
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3" />
          <Input
            aria-label="Tìm nhân viên"
            placeholder="Mã, họ tên, email"
            className="pl-9"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <Select aria-label="Vai trò" className="w-auto" value={role} onChange={(e) => setRole(e.target.value as LmsRole | "")}>
          <option value="">Mọi vai trò</option>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE[r].label}
            </option>
          ))}
        </Select>
        <Select
          aria-label="Trạng thái"
          className="w-auto"
          value={status}
          onChange={(e) => setStatus(e.target.value as UserStatus | "")}
        >
          <option value="">Mọi trạng thái</option>
          {(Object.keys(USER_STATUS) as UserStatus[]).map((s) => (
            <option key={s} value={s}>
              {USER_STATUS[s].label}
            </option>
          ))}
        </Select>
      </div>

      <Card>
        {query.isPending ? (
          <Spinner />
        ) : !query.data?.items.length ? (
          <Empty title="Không có nhân viên" />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <th>Mã NV</th>
                  <th>Nhân viên</th>
                  <th>Chức danh</th>
                  <th>Vai trò</th>
                  <th>Trạng thái</th>
                  <th>Đăng nhập</th>
                  <th className="w-40" />
                </tr>
              </thead>
              <tbody>
                {query.data.items.map((e) => {
                  const self = e.id === me!.user.id;
                  return (
                    <tr key={e.id}>
                      <td className="font-mono text-xs">{e.employee_code}</td>
                      <td>
                        <div className="flex items-center gap-2.5">
                          <Avatar name={e.full_name} id={e.id} size="sm" />
                          <div className="min-w-0">
                            <p className="truncate font-medium">
                              {e.full_name}
                              {self && <span className="ml-1.5 text-xs font-normal text-ink-3">(bạn)</span>}
                            </p>
                            <p className="truncate text-xs text-ink-3">{e.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="text-ink-2">{e.job_title || "—"}</td>
                      <td>
                        <MetaBadge meta={ROLE[e.role]} dot={false} />
                      </td>
                      <td>
                        <MetaBadge meta={USER_STATUS[e.status]} />
                      </td>
                      <td className="text-ink-3">{fmtRelative(e.last_login_at)}</td>
                      <td>
                        <div className="flex justify-end">
                          <IconButton label="Sửa" onClick={() => setModal({ kind: "edit", employee: e })}>
                            <Pencil className="size-4" />
                          </IconButton>
                          <IconButton label="Đặt lại mật khẩu" onClick={() => setModal({ kind: "password", employee: e })}>
                            <KeyRound className="size-4" />
                          </IconButton>
                          {!self &&
                            (e.status === "active" ? (
                              <IconButton
                                label="Khoá tài khoản"
                                onClick={() =>
                                  confirm(`Khoá tài khoản ${e.full_name}? Không đăng nhập được cả LMS và Project Manager.`) &&
                                  update.mutate({ e, status: "locked" })
                                }
                              >
                                <Lock className="size-4" />
                              </IconButton>
                            ) : (
                              <IconButton label="Mở khoá" onClick={() => update.mutate({ e, status: "active" })}>
                                <LockOpen className="size-4" />
                              </IconButton>
                            ))}
                          {!self && (
                            <IconButton
                              label="Gỡ khỏi công ty"
                              className="hover:text-danger"
                              onClick={() =>
                                confirm(
                                  `Gỡ ${e.full_name} khỏi công ty? Toàn bộ ghi danh và tiến độ học LMS bị xoá; tài khoản Project Manager vẫn giữ.`,
                                ) && remove.mutate(e)
                              }
                            >
                              <UserMinus className="size-4" />
                            </IconButton>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
            <Pagination page={page} size={SIZE} total={query.data.total} onChange={setPage} />
          </>
        )}
      </Card>

      {modal?.kind === "create" && (
        <EmployeeModal base={base} companyCode={company?.code ?? ""} onClose={() => setModal(null)} />
      )}
      {modal?.kind === "edit" && (
        <EmployeeModal base={base} employee={modal.employee} companyCode={company?.code ?? ""} onClose={() => setModal(null)} />
      )}
      {modal?.kind === "password" && (
        <ResetPasswordModal base={base} employee={modal.employee} onClose={() => setModal(null)} />
      )}
      {modal?.kind === "link" && <LinkUserModal base={base} onClose={() => setModal(null)} />}
    </>
  );
}
