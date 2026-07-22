"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { SelectInput, TextInput } from "@/components/ui/Field";
import { EmptyState, ErrorBanner, Spinner } from "@/components/ui/Feedback";
import { exportElementToPdf } from "@/lib/export/exportToPdf";
import { addDaysToDateStr, formatDateAr, formatMonthAr, todayBahrain, weekStart } from "@/lib/date";
import type { FinancialSummary, WorkerFinancialSummary } from "@/lib/server/financialSummary";

type RangeMode = "today" | "week" | "month" | "custom";
type Granularity = "daily" | "weekly" | "monthly";

export default function FinancialSettlementPage() {
  const today = todayBahrain();
  const [rangeMode, setRangeMode] = useState<RangeMode>("month");
  const [customStart, setCustomStart] = useState(addDaysToDateStr(today, -29));
  const [customEnd, setCustomEnd] = useState(today);
  const [granularity, setGranularity] = useState<Granularity>("daily");
  const [expandedWorkerId, setExpandedWorkerId] = useState<string | null>(null);

  const { start, end } = useMemo(() => {
    if (rangeMode === "today") return { start: today, end: today };
    if (rangeMode === "week") {
      const ws = weekStart(today);
      return { start: ws, end: addDaysToDateStr(ws, 6) };
    }
    if (rangeMode === "month") {
      const s = today.slice(0, 7) + "-01";
      const nextMonth = addDaysToDateStr(s, 32).slice(0, 7) + "-01";
      return { start: s, end: addDaysToDateStr(nextMonth, -1) };
    }
    return { start: customStart, end: customEnd };
  }, [rangeMode, customStart, customEnd, today]);

  const [summary, setSummary] = useState<FinancialSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/financial-summary?start=${start}&end=${end}`)
      .then((res) => res.json())
      .then((json: { summary?: FinancialSummary; error?: string }) => {
        if (cancelled) return;
        if (json.summary) {
          setSummary(json.summary);
          setError("");
        } else {
          setError(json.error ?? "تعذر حساب التسوية المالية");
        }
      })
      .catch(() => {
        if (!cancelled) setError("تعذر حساب التسوية المالية");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [start, end]);

  const printableRef = useRef<HTMLDivElement>(null);
  const [exportingPdf, setExportingPdf] = useState(false);

  async function handleExportPdf() {
    if (!printableRef.current) return;
    setExportingPdf(true);
    try {
      await exportElementToPdf(printableRef.current, `financial-settlement_${start}_${end}.pdf`);
    } finally {
      setExportingPdf(false);
    }
  }

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold text-slate-900">التسوية المالية</h1>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" loading={exportingPdf} onClick={handleExportPdf}>
            تصدير PDF
          </Button>
          <a
            href={`/api/financial-summary/export?start=${start}&end=${end}`}
            className="inline-flex min-h-9 items-center justify-center gap-2 rounded-xl bg-slate-100 px-3 py-2 text-sm font-medium text-slate-800 transition-colors hover:bg-slate-200"
          >
            تصدير Excel
          </a>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 sm:grid-cols-3">
        <SelectInput label="الفترة" value={rangeMode} onChange={(e) => setRangeMode(e.target.value as RangeMode)}>
          <option value="today">اليوم</option>
          <option value="week">هذا الأسبوع</option>
          <option value="month">هذا الشهر</option>
          <option value="custom">مدى تاريخ مخصص</option>
        </SelectInput>
        {rangeMode === "custom" && (
          <>
            <TextInput label="من تاريخ" type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} />
            <TextInput label="إلى تاريخ" type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} />
          </>
        )}
      </div>

      <ErrorBanner message={error} />

      {loading ? (
        <Spinner label="جارٍ حساب التسوية المالية..." />
      ) : !summary ? null : (
        <div ref={printableRef} className="flex flex-col gap-4 bg-slate-50 p-1">
          <div className="rounded-xl bg-slate-100 px-4 py-2 text-sm text-slate-600">
            {formatDateAr(summary.rangeStart)} — {formatDateAr(summary.rangeEnd)}
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <TotalCard label="إجمالي التحصيل من العملاء" value={summary.overallTotal} tone="slate" />
            <TotalCard label="إجمالي أرباح العاملات" value={summary.workersTotal} tone="amber" />
            <TotalCard label="صافي المدير" value={summary.managerNet} tone="emerald" />
          </div>

          {summary.workers.length === 0 ? (
            <EmptyState message="لا يوجد حجوزات مكتملة ومدفوعة ضمن هذه الفترة" />
          ) : (
            <>
              <div className="overflow-x-auto rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
                <table className="w-full min-w-max text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-slate-600">
                      <th className="px-3 py-2 text-right font-medium">العاملة</th>
                      <th className="px-3 py-2 text-right font-medium">الحجوزات المكتملة</th>
                      <th className="px-3 py-2 text-right font-medium">الحجوزات المدفوعة</th>
                      <th className="px-3 py-2 text-right font-medium">إجمالي الأرباح</th>
                      <th className="px-3 py-2 text-right font-medium"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.workers.map((w) => (
                      <WorkerRow
                        key={w.workerId}
                        worker={w}
                        granularity={granularity}
                        expanded={expandedWorkerId === w.workerId}
                        onToggle={() =>
                          setExpandedWorkerId(expandedWorkerId === w.workerId ? null : w.workerId)
                        }
                      />
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-sm text-slate-500">تفصيل الأرباح:</span>
                <div className="flex gap-1">
                  {(
                    [
                      { value: "daily", label: "يومي" },
                      { value: "weekly", label: "أسبوعي" },
                      { value: "monthly", label: "شهري" },
                    ] as { value: Granularity; label: string }[]
                  ).map((g) => (
                    <button
                      key={g.value}
                      type="button"
                      onClick={() => setGranularity(g.value)}
                      className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                        granularity === g.value
                          ? "border-emerald-600 bg-emerald-600 text-white"
                          : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                      }`}
                    >
                      {g.label}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

type Tone = "slate" | "amber" | "emerald";

function TotalCard({ label, value, tone }: { label: string; value: number; tone: Tone }) {
  const toneClasses: Record<Tone, string> = {
    slate: "bg-slate-50 text-slate-900",
    amber: "bg-amber-50 text-amber-800",
    emerald: "bg-emerald-50 text-emerald-800",
  };
  return (
    <div className={`rounded-2xl p-4 text-center shadow-sm ring-1 ring-slate-200 ${toneClasses[tone]}`}>
      <p className="text-xs opacity-70">{label}</p>
      <p className="mt-1 text-xl font-bold">{value.toFixed(3)} د.ب</p>
    </div>
  );
}

function WorkerRow({
  worker,
  granularity,
  expanded,
  onToggle,
}: {
  worker: WorkerFinancialSummary;
  granularity: Granularity;
  expanded: boolean;
  onToggle: () => void;
}) {
  const rows =
    granularity === "daily" ? worker.daily : granularity === "weekly" ? worker.weekly : worker.monthly;

  return (
    <>
      <tr className="border-b border-slate-100">
        <td className="px-3 py-2 font-medium text-slate-900">{worker.workerName}</td>
        <td className="px-3 py-2">{worker.totalCompletedBookings}</td>
        <td className="px-3 py-2">{worker.totalPaidBookings}</td>
        <td className="px-3 py-2 font-semibold text-emerald-700">{worker.totalEarnings.toFixed(3)} د.ب</td>
        <td className="px-3 py-2 text-left">
          <button type="button" onClick={onToggle} className="text-xs font-medium text-emerald-700 hover:underline">
            {expanded ? "إخفاء التفصيل" : "عرض التفصيل"}
          </button>
        </td>
      </tr>
      {expanded && (
        <tr className="border-b border-slate-100 bg-slate-50">
          <td colSpan={5} className="px-3 py-3">
            {rows.length === 0 ? (
              <p className="text-xs text-slate-400">لا توجد بيانات</p>
            ) : (
              <table className="w-full min-w-max text-xs">
                <thead>
                  <tr className="text-slate-500">
                    <th className="px-2 py-1 text-right font-medium">الفترة</th>
                    <th className="px-2 py-1 text-right font-medium">حجوزات مكتملة</th>
                    <th className="px-2 py-1 text-right font-medium">حجوزات مدفوعة</th>
                    <th className="px-2 py-1 text-right font-medium">الأرباح</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const period = "date" in r ? r.date : r.period;
                    const label =
                      granularity === "daily"
                        ? formatDateAr(period)
                        : granularity === "weekly"
                          ? `أسبوع ${formatDateAr(period)}`
                          : formatMonthAr(period);
                    return (
                      <tr key={period} className="border-t border-slate-200">
                        <td className="px-2 py-1">{label}</td>
                        <td className="px-2 py-1">{r.completedBookings}</td>
                        <td className="px-2 py-1">{r.paidBookings}</td>
                        <td className="px-2 py-1 font-medium">{r.earnings.toFixed(3)} د.ب</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
