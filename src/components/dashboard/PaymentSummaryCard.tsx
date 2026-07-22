"use client";

import { usePolledFetch } from "@/hooks/usePolledFetch";
import type { PaymentSummary } from "@/lib/server/paymentSummary";

async function fetchSummary(): Promise<PaymentSummary> {
  const res = await fetch("/api/dashboard/payment-summary");
  if (!res.ok) throw new Error("تعذر تحميل ملخص المدفوعات");
  const json = (await res.json()) as { summary?: PaymentSummary };
  if (!json.summary) throw new Error("تعذر تحميل ملخص المدفوعات");
  return json.summary;
}

const ROWS: { key: keyof PaymentSummary; label: string }[] = [
  { key: "totalUnpaid", label: "إجمالي غير المدفوع" },
  { key: "totalPaidToday", label: "المدفوع اليوم" },
  { key: "totalPaidThisWeek", label: "المدفوع هذا الأسبوع" },
  { key: "cashTotal", label: "إجمالي النقدي" },
  { key: "benefitTotal", label: "إجمالي بنفت" },
  { key: "grandTotal", label: "إجمالي المحصّل" },
];

export function PaymentSummaryCard() {
  const { data: summary, loading } = usePolledFetch(fetchSummary, []);

  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <h2 className="mb-3 font-semibold text-slate-900">ملخص المدفوعات</h2>
      {loading && !summary ? (
        <p className="text-sm text-slate-400">جارِ التحميل...</p>
      ) : !summary ? (
        <p className="text-sm text-slate-400">تعذر تحميل الملخص</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {ROWS.map((row) => (
            <div key={row.key} className="rounded-xl bg-slate-50 p-3 text-center">
              <p className="text-xs text-slate-500">{row.label}</p>
              <p className="mt-1 text-base font-bold text-slate-900">{summary[row.key].toFixed(3)} د.ب</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
