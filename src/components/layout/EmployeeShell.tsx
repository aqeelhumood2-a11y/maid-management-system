"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { ErrorBanner } from "@/components/ui/Feedback";
import { TextInput } from "@/components/ui/Field";
import { useManagerSession } from "@/context/ManagerSessionContext";

const NAV_ITEMS = [
  { href: "/", label: "اليوم" },
  { href: "/weekly", label: "الأسبوع" },
];

export function EmployeeShell({
  businessName,
  children,
}: {
  businessName: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const { isManager } = useManagerSession();
  const [loginOpen, setLoginOpen] = useState(false);

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <p className="text-sm font-bold text-slate-900">{businessName}</p>
          {isManager ? (
            <Link
              href="/manager"
              className="rounded-lg px-3 py-2 text-xs font-medium text-slate-500 hover:bg-slate-100"
            >
              لوحة المدير ←
            </Link>
          ) : (
            <button
              onClick={() => setLoginOpen(true)}
              aria-label="دخول المدير"
              className="rounded-lg px-2 py-1.5 text-xs text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            >
              ⚙︎
            </button>
          )}
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
        </nav>
      </header>
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 py-5">{children}</main>

      {loginOpen && <ManagerLoginModal onClose={() => setLoginOpen(false)} />}
    </div>
  );
}

function ManagerLoginModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const { setIsManager } = useManagerSession();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/manager/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error || "كلمة المرور غير صحيحة");
        setLoading(false);
        return;
      }
      setIsManager(true);
      router.push("/manager");
    } catch {
      setError("تعذر الاتصال بالخادم، حاول مرة أخرى");
      setLoading(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="دخول المدير">
      <form onSubmit={handleSubmit} className="space-y-4">
        <ErrorBanner message={error} />
        <TextInput
          label="كلمة المرور"
          type="password"
          required
          autoFocus
          dir="ltr"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <Button type="submit" fullWidth loading={loading}>
          دخول
        </Button>
      </form>
    </Modal>
  );
}
