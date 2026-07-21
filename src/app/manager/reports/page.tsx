"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { SelectInput, TextInput } from "@/components/ui/Field";
import { EmptyState, Spinner } from "@/components/ui/Feedback";
import { useAreas } from "@/hooks/useAreas";
import { usePolledFetch } from "@/hooks/usePolledFetch";
import { useWorkers } from "@/hooks/useWorkers";
import { addDaysToDateStr, formatDateAr, todayBahrain, weekStart } from "@/lib/date";
import type { Booking, PaymentMethod, Shift } from "@/lib/types";

const SHIFT_LABEL: Record<Shift, string> = { morning: "صباحي", afternoon: "مسائي" };
const PAYMENT_LABEL: Record<string, string> = { benefit: "بنفت", cash: "نقدي" };

type RangeMode = "day" | "range" | "week" | "month" | "all";

export default function ReportsPage() {
  const { workers } = useWorkers();
  const { areas } = useAreas();
  const today = todayBahrain();

  const [rangeMode, setRangeMode] = useState<RangeMode>("month");
  const [exactDate, setExactDate] = useState(today);
  const [rangeStart, setRangeStart] = useState(addDaysToDateStr(today, -29));
  const [rangeEnd, setRangeEnd] = useState(today);
  const [workerId, setWorkerId] = useState("");
  const [areaId, setAreaId] = useState("");
  const [paidFilter, setPaidFilter] = useState<"" | "paid" | "unpaid">("");
  const [paymentMethod, setPaymentMethod] = useState<"" | PaymentMethod>("");
  const [shift, setShift] = useState<"" | Shift>("");

  const { start, end } = useMemo(() => {
    if (rangeMode === "day") return { start: exactDate, end: exactDate };
    if (rangeMode === "range") return { start: rangeStart, end: rangeEnd };
    if (rangeMode === "week") {
      const ws = weekStart(today);
      return { start: ws, end: addDaysToDateStr(ws, 6) };
    }
    if (rangeMode === "month") {
      const s = today.slice(0, 7) + "-01";
      const nextMonth = addDaysToDateStr(s, 32).slice(0, 7) + "-01";
      return { start: s, end: addDaysToDateStr(nextMonth, -1) };
    }
    return { start: "2000-01-01", end: "2100-01-01" };
  }, [rangeMode, exactDate, rangeStart, rangeEnd, today]);

  const { data, loading } = usePolledFetch(
    async () => {
      const res = await fetch(`/api/bookings?start=${start}&end=${end}`);
      const json = (await res.json()) as { bookings?: Booking[] };
      return json.bookings ?? [];
    },
    [start, end]
  );

  const filtered = useMemo(() => {
    return (data ?? []).filter((b) => {
      if (workerId && b.workerId !== workerId) return false;
      if (areaId && b.areaId !== areaId) return false;
      if (shift && b.shift !== shift) return false;
      if (paidFilter === "paid" && !b.paid) return false;
      if (paidFilter === "unpaid" && b.paid) return false;
      if (paymentMethod && b.paymentMethod !== paymentMethod) return false;
      return true;
    });
  }, [data, workerId, areaId, shift, paidFilter, paymentMethod]);

  const totals = useMemo(() => {
    const totalHours = filtered.reduce((s, b) => s + b.hours, 0);
    const totalRevenue = filtered.reduce((s, b) => s + b.amount, 0);
    const workedDays = new Set(filtered.map((b) => b.date)).size;
    return { totalHours, totalRevenue, workedDays, count: filtered.length };
  }, [filtered]);

  function resetFilters() {
    setRangeMode("month");
    setWorkerId("");
    setAreaId("");
    setPaidFilter("");
    setPaymentMethod("");
    setShift("");
  }

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-900">التقارير</h1>
        <Button variant="secondary" size="sm" onClick={resetFilters}>
          إعادة ضبط الفلاتر
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 sm:grid-cols-2 lg:grid-cols-3">
        <SelectInput label="الفترة" value={rangeMode} onChange={(e) => setRangeMode(e.target.value as RangeMode)}>
          <option value="day">تاريخ محدد</option>
          <option value="range">مدى تاريخ</option>
          <option value="week">هذا الأسبوع</option>
          <option value="month">هذا الشهر</option>
          <option value="all">الكل</option>
        </SelectInput>

        {rangeMode === "day" && (
          <TextInput label="التاريخ" type="date" value={exactDate} onChange={(e) => setExactDate(e.target.value)} />
        )}
        {rangeMode === "range" && (
          <>
            <TextInput label="من تاريخ" type="date" value={rangeStart} onChange={(e) => setRangeStart(e.target.value)} />
            <TextInput label="إلى تاريخ" type="date" value={rangeEnd} onChange={(e) => setRangeEnd(e.target.value)} />
          </>
        )}

        <SelectInput label="العاملة" value={workerId} onChange={(e) => setWorkerId(e.target.value)}>
          <option value="">الكل</option>
          {workers.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </SelectInput>
        <SelectInput label="المنطقة" value={areaId} onChange={(e) => setAreaId(e.target.value)}>
          <option value="">الكل</option>
          {areas.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </SelectInput>
        <SelectInput label="الفترة (صباحي/مسائي)" value={shift} onChange={(e) => setShift(e.target.value as "" | Shift)}>
          <option value="">الكل</option>
          <option value="morning">صباحي</option>
          <option value="afternoon">مسائي</option>
        </SelectInput>
        <SelectInput label="حالة الدفع" value={paidFilter} onChange={(e) => setPaidFilter(e.target.value as typeof paidFilter)}>
          <option value="">الكل</option>
          <option value="paid">مدفوع</option>
          <option value="unpaid">غير مدفوع</option>
        </SelectInput>
        <SelectInput label="طريقة الدفع" value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value as "" | PaymentMethod)}>
          <option value="">الكل</option>
          <option value="benefit">بنفت</option>
          <option value="cash">نقدي</option>
        </SelectInput>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="عدد الحجوزات" value={String(totals.count)} />
        <StatCard label="إجمالي الساعات" value={totals.totalHours.toFixed(1)} />
        <StatCard label="أيام العمل" value={String(totals.workedDays)} />
        <StatCard label="الإيرادات" value={`${totals.totalRevenue.toFixed(3)} د.ب`} />
      </div>

      {loading ? (
        <Spinner />
      ) : filtered.length === 0 ? (
        <EmptyState message="لا يوجد حجوزات مطابقة للفلاتر المحددة" />
      ) : (
        <div className="overflow-x-auto rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
          <table className="w-full min-w-max text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-slate-600">
                <th className="px-3 py-2 text-right font-medium">التاريخ</th>
                <th className="px-3 py-2 text-right font-medium">الفترة</th>
                <th className="px-3 py-2 text-right font-medium">العاملة</th>
                <th className="px-3 py-2 text-right font-medium">المنطقة</th>
                <th className="px-3 py-2 text-right font-medium">الساعات</th>
                <th className="px-3 py-2 text-right font-medium">المبلغ</th>
                <th className="px-3 py-2 text-right font-medium">الدفع</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((b) => (
                <tr key={b.id} className="border-b border-slate-100">
                  <td className="px-3 py-2">{formatDateAr(b.date)}</td>
                  <td className="px-3 py-2">{SHIFT_LABEL[b.shift]}</td>
                  <td className="px-3 py-2">{b.workerName}</td>
                  <td className="px-3 py-2">{b.areaName}</td>
                  <td className="px-3 py-2">{b.hours}</td>
                  <td className="px-3 py-2">{b.amount.toFixed(3)}</td>
                  <td className="px-3 py-2">
                    {b.paymentMethod ? PAYMENT_LABEL[b.paymentMethod] : "غير مدفوع"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-white p-4 text-center shadow-sm ring-1 ring-slate-200">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 text-lg font-bold text-slate-900">{value}</p>
    </div>
  );
}
