"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Search, Trash2, Users } from "lucide-react";
import Link from "next/link";
import { useDeferredValue, useState } from "react";

import { MetaBadge } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Card, Empty, PageHeader, Pagination, Spinner, Table } from "@/components/ui/misc";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { api, clean } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { COMPANY_STATUS } from "@/lib/labels";
import type { Company, CompanyStatus, Page } from "@/lib/types";
import { fmtDate } from "@/lib/utils";

const SIZE = 20;
const CODE_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{1,29}$/;

function CompanyModal({ company, onClose }: { company?: Company; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { me } = useAuth();
  const [form, setForm] = useState({
    code: company?.code ?? "",
    name: company?.name ?? "",
    short_name: company?.short_name ?? "",
    tax_code: company?.tax_code ?? "",
    email: company?.email ?? "",
    phone: company?.phone ?? "",
    address: company?.address ?? "",
    logo_url: company?.logo_url ?? "",
    status: company?.status ?? ("active" as CompanyStatus),
  });
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));
  const save = useMutation({
    mutationFn: async () => {
      const optional = (v: string) => v.trim() || null;
      const body = {
        name: form.name.trim(),
        short_name: optional(form.short_name),
        tax_code: optional(form.tax_code),
        email: optional(form.email),
        phone: optional(form.phone),
        address: optional(form.address),
        logo_url: optional(form.logo_url),
      };
      if (company) await api.patch(`/companies/${company.id}`, { ...body, status: form.status });
      else await api.post("/companies", { ...body, code: form.code.trim() });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["companies"] });
      toast.success(company ? "Đã lưu doanh nghiệp" : "Đã tạo doanh nghiệp");
      onClose();
    },
    onError: toast.error,
  });
  const valid = form.name.trim() && (company || CODE_RE.test(form.code.trim()));

  return (
    <Modal
      open
      size="lg"
      onClose={onClose}
      title={company ? `Sửa ${company.code}` : "Doanh nghiệp mới"}
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
        <Field label="Mã công ty" required={!company} hint={company ? "Không đổi được mã" : "Nhân viên nhập khi đăng nhập (2–30 ký tự)"}>
          {(id) => <Input id={id} value={form.code} disabled={!!company} onChange={(e) => set("code", e.target.value)} />}
        </Field>
        <Field label="Tên viết tắt">
          {(id) => <Input id={id} value={form.short_name} onChange={(e) => set("short_name", e.target.value)} />}
        </Field>
        <Field label="Tên doanh nghiệp" required className="sm:col-span-2">
          {(id) => <Input id={id} value={form.name} onChange={(e) => set("name", e.target.value)} />}
        </Field>
        <Field label="Mã số thuế">
          {(id) => <Input id={id} value={form.tax_code} onChange={(e) => set("tax_code", e.target.value)} />}
        </Field>
        <Field label="Email">
          {(id) => <Input id={id} type="email" value={form.email} onChange={(e) => set("email", e.target.value)} />}
        </Field>
        <Field label="Điện thoại">
          {(id) => <Input id={id} value={form.phone} onChange={(e) => set("phone", e.target.value)} />}
        </Field>
        <Field label="Logo (URL)">
          {(id) => <Input id={id} type="url" value={form.logo_url} onChange={(e) => set("logo_url", e.target.value)} />}
        </Field>
        <Field label="Địa chỉ" className="sm:col-span-2">
          {(id) => <Textarea id={id} rows={2} value={form.address} onChange={(e) => set("address", e.target.value)} />}
        </Field>
        {company && company.id !== me?.company.id && (
          <Field label="Trạng thái" hint="Ngừng hoạt động: nhân viên không đăng nhập LMS được">
            {(id) => (
              <Select id={id} value={form.status} onChange={(e) => set("status", e.target.value as CompanyStatus)}>
                {(Object.keys(COMPANY_STATUS) as CompanyStatus[]).map((s) => (
                  <option key={s} value={s}>
                    {COMPANY_STATUS[s].label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
      </div>
    </Modal>
  );
}

export default function CompaniesPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const { me } = useAuth();
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Company | "new" | null>(null);
  const search = useDeferredValue(q);
  const params = clean({ q: search, page, size: SIZE });
  const query = useQuery({
    queryKey: ["companies", "list", params],
    queryFn: async () => (await api.get<Page<Company>>("/companies", { params })).data,
    placeholderData: keepPreviousData,
  });
  const remove = useMutation({
    mutationFn: (c: Company) => api.delete(`/companies/${c.id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["companies"] });
      toast.success("Đã xoá doanh nghiệp");
    },
    onError: toast.error,
  });

  return (
    <>
      <PageHeader
        title="Doanh nghiệp"
        description="Mỗi doanh nghiệp có nhân viên, khoá học và tài liệu riêng"
        actions={
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing("new")}>
            Doanh nghiệp mới
          </Button>
        }
      />
      <div className="relative mb-4 w-full sm:w-72">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3" />
        <Input
          aria-label="Tìm doanh nghiệp"
          placeholder="Mã, tên doanh nghiệp"
          className="pl-9"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
        />
      </div>
      <Card>
        {query.isPending ? (
          <Spinner />
        ) : !query.data?.items.length ? (
          <Empty title="Chưa có doanh nghiệp" />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <th>Mã</th>
                  <th>Doanh nghiệp</th>
                  <th>Mã số thuế</th>
                  <th>Liên hệ</th>
                  <th>Trạng thái</th>
                  <th>Ngày tạo</th>
                  <th className="w-28" />
                </tr>
              </thead>
              <tbody>
                {query.data.items.map((c) => (
                  <tr key={c.id}>
                    <td className="font-mono text-xs font-medium">{c.code}</td>
                    <td>
                      <p className="font-medium">
                        {c.name}
                        {c.id === me?.company.id && <span className="ml-1.5 text-xs font-normal text-ink-3">(công ty của bạn)</span>}
                      </p>
                      {c.address && <p className="truncate text-xs text-ink-3">{c.address}</p>}
                    </td>
                    <td className="text-ink-2">{c.tax_code || "—"}</td>
                    <td className="text-ink-2">
                      {c.email || "—"}
                      {c.phone && <span className="block text-xs text-ink-3">{c.phone}</span>}
                    </td>
                    <td>
                      <MetaBadge meta={COMPANY_STATUS[c.status]} />
                    </td>
                    <td className="text-ink-2">{fmtDate(c.created_at)}</td>
                    <td>
                      <div className="flex justify-end">
                        <Link href={`/admin/employees?company=${c.id}`}>
                          <IconButton label="Nhân viên">
                            <Users className="size-4" />
                          </IconButton>
                        </Link>
                        <IconButton label="Sửa" onClick={() => setEditing(c)}>
                          <Pencil className="size-4" />
                        </IconButton>
                        {c.id !== me?.company.id && (
                          <IconButton
                            label="Xoá"
                            className="hover:text-danger"
                            onClick={() => confirm(`Xoá doanh nghiệp ${c.code}? Chỉ xoá được khi không còn nhân viên.`) && remove.mutate(c)}
                          >
                            <Trash2 className="size-4" />
                          </IconButton>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pagination page={page} size={SIZE} total={query.data.total} onChange={setPage} />
          </>
        )}
      </Card>
      {editing && <CompanyModal company={editing === "new" ? undefined : editing} onClose={() => setEditing(null)} />}
    </>
  );
}
