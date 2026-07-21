"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { ManagerNav } from "@/components/layout/ManagerNav";
import { useManagerSession } from "@/context/ManagerSessionContext";

export function ManagerShell({
  businessName,
  children,
}: {
  businessName: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const { setIsManager } = useManagerSession();
  const [confirmLogout, setConfirmLogout] = useState(false);

  async function logout() {
    await fetch("/api/manager/login", { method: "DELETE" });
    setIsManager(false);
    router.push("/");
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <div>
            <p className="text-sm font-bold text-slate-900">{businessName}</p>
            <p className="text-xs text-slate-500">لوحة المدير</p>
          </div>
          <div className="flex items-center gap-1">
            <Link href="/" className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100">
              → الجدول
            </Link>
            <button
              onClick={() => setConfirmLogout(true)}
              className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
            >
              تسجيل الخروج
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-5 px-4 py-5">
        <ManagerNav />
        <div>{children}</div>
      </main>

      <ConfirmDialog
        open={confirmLogout}
        onClose={() => setConfirmLogout(false)}
        onConfirm={logout}
        title="تسجيل الخروج"
        message="هل تريد تسجيل الخروج من لوحة المدير؟"
        confirmLabel="تسجيل الخروج"
        danger
      />
    </div>
  );
}
