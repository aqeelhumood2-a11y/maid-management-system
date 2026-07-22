import Link from "next/link";
import { PaymentSummaryCard } from "@/components/dashboard/PaymentSummaryCard";

const SECTIONS = [
  { href: "/manager/future-booking", label: "حجز مستقبلي", desc: "إنشاء حجز بتاريخ مستقبلي محدد", icon: "📅" },
  { href: "/manager/workers", label: "إدارة العاملات", desc: "إضافة وتعديل وتفعيل العاملات", icon: "👥" },
  { href: "/manager/recurring", label: "الجدول المتكرر", desc: "مواعيد أسبوعية متكررة", icon: "🔁" },
  { href: "/manager/routes", label: "خطوط السير", desc: "حجوزات يوم محدد حسب المنطقة", icon: "🗺️" },
  { href: "/manager/reports", label: "التقارير", desc: "تحليل الحجوزات والإيرادات", icon: "📊" },
  { href: "/manager/unpaid", label: "المدفوعات", desc: "متابعة حالة الدفع لكل حجز", icon: "💳" },
  { href: "/manager/activity", label: "سجل النشاط", desc: "سجل العمليات في النظام", icon: "🕒" },
  { href: "/manager/settings", label: "الإعدادات", desc: "بيانات النظام والمناطق والمستخدمين", icon: "⚙️" },
];

export default function ManagerHomePage() {
  return (
    <div className="flex flex-col gap-4">
      <PaymentSummaryCard />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {SECTIONS.map((s) => (
          <Link
            key={s.href}
            href={s.href}
            className="flex items-start gap-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 transition hover:ring-emerald-400"
          >
            <span className="text-2xl">{s.icon}</span>
            <span>
              <span className="block font-semibold text-slate-900">{s.label}</span>
              <span className="block text-sm text-slate-500">{s.desc}</span>
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
