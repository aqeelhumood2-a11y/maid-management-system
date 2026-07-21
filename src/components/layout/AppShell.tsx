"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

const NAV_ITEMS = [
  { href: "/today", label: "اليوم" },
  { href: "/weekly", label: "الأسبوع" },
];

export function AppShell({
  businessName,
  children,
}: {
  businessName: string;
  children: React.ReactNode;
}) {
  const { user, logout } = useAuth();
  const pathname = usePathname();
  const [confirmLogout, setConfirmLogout] = useState(false);

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <div>
            <p className="text-sm font-bold text-slate-900">{businessName}</p>
            <p className="text-xs text-slate-500">
              {user.name} · {user.role === "manager" ? "مدير" : "موظف"}
            </p>
          </div>
          <button
            onClick={() => setConfirmLogout(true)}
            className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
          >
            تسجيل الخروج
          </button>
        </div>
        <nav className="mx-auto flex max-w-5xl gap-1 overflow-x-auto px-4 pb-2">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`rounded-lg px-4 py-2 text-sm font-medium whitespace-nowrap ${
                pathname === item.href
                  ? "bg-emerald-600 text-white"
                  : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              {item.label}
            </Link>
          ))}
          {user.role === "manager" && (
            <Link
              href="/manager"
              className={`rounded-lg px-4 py-2 text-sm font-medium whitespace-nowrap ${
                pathname.startsWith("/manager")
                  ? "bg-emerald-600 text-white"
                  : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              الإدارة
            </Link>
          )}
        </nav>
      </header>
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 py-5">{children}</main>

      <ConfirmDialog
        open={confirmLogout}
        onClose={() => setConfirmLogout(false)}
        onConfirm={logout}
        title="تسجيل الخروج"
        message="هل تريد تسجيل الخروج من النظام؟"
        confirmLabel="تسجيل الخروج"
        danger
      />
    </div>
  );
}
