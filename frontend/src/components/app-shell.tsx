"use client";

import {
  BarChart3,
  BookOpen,
  Building2,
  FolderTree,
  GraduationCap,
  LayoutDashboard,
  Library,
  ListChecks,
  LogOut,
  Menu,
  UserCog,
  Users,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Avatar, Spinner } from "@/components/ui/misc";
import { useAuth } from "@/lib/auth";
import { ROLE } from "@/lib/labels";
import type { Permission } from "@/lib/types";
import { cn } from "@/lib/utils";

type NavItem = { href: string; label: string; icon: typeof LayoutDashboard; perm?: Permission };

const SECTIONS: { title?: string; items: NavItem[] }[] = [
  {
    items: [
      { href: "/", label: "Tổng quan", icon: LayoutDashboard },
      { href: "/my-courses", label: "Khoá học của tôi", icon: GraduationCap },
      { href: "/courses", label: "Danh mục khoá học", icon: BookOpen },
      { href: "/documents", label: "Thư viện tài liệu", icon: Library },
    ],
  },
  {
    title: "Quản lý đào tạo",
    items: [
      { href: "/enrollments", label: "Ghi danh & tiến độ", icon: ListChecks, perm: "report.view" },
      { href: "/reports", label: "Báo cáo", icon: BarChart3, perm: "report.view" },
      { href: "/admin/categories", label: "Danh mục", icon: FolderTree, perm: "content.manage" },
    ],
  },
  {
    title: "Quản trị",
    items: [
      { href: "/admin/employees", label: "Nhân viên", icon: Users, perm: "employee.manage" },
      { href: "/admin/companies", label: "Doanh nghiệp", icon: Building2, perm: "company.manage" },
    ],
  },
];

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

function NavLink({ item, pathname, onClick }: { item: NavItem; pathname: string; onClick?: () => void }) {
  const active = isActive(pathname, item.href);
  return (
    <Link
      href={item.href}
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] font-medium transition-colors",
        active ? "bg-brand-soft text-brand" : "text-ink-2 hover:bg-subtle hover:text-ink",
      )}
    >
      <item.icon className="size-4 shrink-0" />
      <span className="truncate">{item.label}</span>
    </Link>
  );
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { me, can, logout } = useAuth();

  return (
    <div className="flex h-full flex-col">
      <Link href="/" className="flex items-center gap-2.5 px-4 py-4" onClick={onNavigate}>
        <span className="flex size-8 items-center justify-center rounded-md bg-brand text-white">
          <GraduationCap className="size-4.5" />
        </span>
        <span className="min-w-0">
          <span className="block leading-tight font-semibold">LMS</span>
          <span className="block truncate text-xs text-ink-3">{me?.company.short_name || me?.company.name}</span>
        </span>
      </Link>

      <nav className="flex-1 space-y-5 overflow-y-auto px-3 pb-4" aria-label="Điều hướng chính">
        {SECTIONS.map((section, i) => {
          const items = section.items.filter((item) => !item.perm || can(item.perm));
          if (!items.length) return null;
          return (
            <div key={i}>
              {section.title && (
                <p className="mb-1 px-2.5 text-[11px] font-semibold tracking-wide text-ink-3 uppercase">
                  {section.title}
                </p>
              )}
              <div className="space-y-0.5">
                {items.map((item) => (
                  <NavLink key={item.href} item={item} pathname={pathname} onClick={onNavigate} />
                ))}
              </div>
            </div>
          );
        })}
      </nav>

      <div className="flex items-center gap-2.5 border-t border-line px-3 py-3">
        <Link
          href="/account"
          onClick={onNavigate}
          className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg p-1 hover:bg-subtle"
          title="Tài khoản của tôi"
        >
          <Avatar name={me?.user.full_name} id={me?.user.id} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-medium">{me?.user.full_name}</span>
            <span className="block truncate text-xs text-ink-3">
              {me?.user.employee_code} · {me && (me.is_system_admin ? "Quản trị hệ thống" : ROLE[me.role].label)}
            </span>
          </span>
        </Link>
        <button
          type="button"
          onClick={logout}
          aria-label="Đăng xuất"
          title="Đăng xuất"
          className="rounded-md p-1.5 text-ink-3 hover:bg-subtle hover:text-ink"
        >
          <LogOut className="size-4" />
        </button>
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { ready, token, me, loadingMe } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    if (ready && !token) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [ready, token, pathname, router]);

  if (!ready || !token || loadingMe || !me) return <Spinner className="min-h-dvh" />;

  return (
    <div className="min-h-dvh lg:pl-60">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 border-r border-line bg-surface lg:block">
        <Sidebar />
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/40" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-64 bg-surface shadow-pop">
            <button
              type="button"
              aria-label="Đóng menu"
              onClick={() => setMobileOpen(false)}
              className="absolute top-4 right-3 rounded-md p-1 text-ink-3 hover:bg-subtle"
            >
              <X className="size-4" />
            </button>
            <Sidebar onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}

      <header className="sticky top-0 z-20 flex h-12 items-center gap-2 border-b border-line bg-surface/90 px-4 backdrop-blur lg:hidden">
        <button
          type="button"
          aria-label="Mở menu"
          onClick={() => setMobileOpen(true)}
          className="rounded-md p-1.5 text-ink-2 hover:bg-subtle"
        >
          <Menu className="size-5" />
        </button>
        <span className="font-semibold">LMS</span>
        <span className="truncate text-ink-3">· {me.company.short_name || me.company.name}</span>
        <Link href="/account" className="ml-auto rounded-md p-1.5 text-ink-2 hover:bg-subtle" aria-label="Tài khoản">
          <UserCog className="size-5" />
        </Link>
      </header>

      <main className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8">{children}</main>
    </div>
  );
}
