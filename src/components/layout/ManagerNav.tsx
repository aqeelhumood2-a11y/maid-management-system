"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/manager/future-booking", label: "حجز مستقبلي" },
  { href: "/manager/workers", label: "العاملات" },
  { href: "/manager/weekly", label: "الجدول الأسبوعي" },
  { href: "/manager/weekly-grid", label: "شبكة الحجز الأسبوعية" },
  { href: "/manager/recurring", label: "الجدول المتكرر" },
  { href: "/manager/routes", label: "خطوط السير" },
  { href: "/manager/reports", label: "التقارير" },
  { href: "/manager/unpaid", label: "المدفوعات" },
  { href: "/manager/financial", label: "التسوية المالية" },
  { href: "/manager/activity", label: "سجل النشاط" },
  { href: "/manager/settings", label: "الإعدادات" },
];

export function ManagerNav() {
  const pathname = usePathname();
  return (
    <nav className="-mx-1 flex gap-1 overflow-x-auto pb-1">
      {ITEMS.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className={`shrink-0 rounded-full border px-4 py-2 text-sm font-medium whitespace-nowrap transition-colors ${
            pathname === item.href
              ? "border-emerald-600 bg-emerald-600 text-white"
              : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
          }`}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
