"use client";

import { useMemo, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { SelectInput, TextArea, TextInput } from "@/components/ui/Field";
import { ErrorBanner, SuccessBanner } from "@/components/ui/Feedback";
import { useWorkers } from "@/hooks/useWorkers";
import { useBookingsForDates } from "@/hooks/useBookingsForDates";
import { useRecurringExceptions, useRecurringSchedules } from "@/hooks/useRecurring";
import { resolveCell } from "@/lib/availability";
import { ApiError, createBooking } from "@/lib/booking";
import { isFriday, todayBahrain } from "@/lib/date";
import type { Shift } from "@/lib/types";

export default function FutureBookingPage() {
  const { workers } = useWorkers();
  const { schedules } = useRecurringSchedules();
  const { exceptions } = useRecurringExceptions();

  const today = todayBahrain();
  const [date, setDate] = useState(today);
  const [shift, setShift] = useState<Shift>("morning");
  const [workerId, setWorkerId] = useState("");
  const [areaName, setAreaName] = useState("");
  const [hours, setHours] = useState("");
  const [amount, setAmount] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerLocation, setCustomerLocation] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);
  const [fridayConfirmed, setFridayConfirmed] = useState(false);

  const { bookings } = useBookingsForDates(date ? [date] : []);
  const friday = date ? isFriday(date) : false;

  const eligibleWorkers = useMemo(() => {
    if (!date) return [];
    return workers
      .filter((w) => w.active)
      .map((w) => ({ worker: w, resolution: resolveCell(w, date, shift, bookings, schedules, exceptions) }))
      .filter(({ resolution }) => resolution.status === "available" || resolution.status === "friday_holiday");
  }, [workers, date, shift, bookings, schedules, exceptions]);

  function reset() {
    setWorkerId("");
    setAreaName("");
    setHours("");
    setAmount("");
    setCustomerName("");
    setCustomerPhone("");
    setCustomerLocation("");
    setFridayConfirmed(false);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setSuccess("");

    const worker = eligibleWorkers.find((x) => x.worker.id === workerId)?.worker;
    const trimmedArea = areaName.trim();
    const hoursNum = Number(hours);
    const amountNum = Number(amount);

    if (!date) return setError("اختر التاريخ");
    if (!worker) return setError("اختر عاملة متاحة");
    if (!trimmedArea) return setError("أدخل اسم المنطقة");
    if (!hoursNum || hoursNum <= 0) return setError("أدخل عدد ساعات صحيح");
    if (Number.isNaN(amountNum) || amountNum < 0) return setError("أدخل مبلغاً صحيحاً");
    if (friday && !fridayConfirmed) return setError("يرجى تأكيد إنشاء حجز استثنائي يوم الجمعة");

    setLoading(true);
    try {
      await createBooking({
        date,
        shift,
        workerId: worker.id,
        workerName: worker.name,
        areaId: trimmedArea,
        areaName: trimmedArea,
        hours: hoursNum,
        amount: amountNum,
        customerName,
        customerPhone,
        customerLocation,
        source: "manager_future",
        recurringSeriesId: null,
      });
      setSuccess("تم إنشاء الحجز بنجاح");
      reset();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "تعذر حفظ الحجز");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-xl">
      <h1 className="mb-4 text-xl font-bold text-slate-900">حجز مستقبلي</h1>
      <form onSubmit={handleSubmit} className="space-y-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
        <ErrorBanner message={error} />
        <SuccessBanner message={success} />

        <div className="grid grid-cols-2 gap-3">
          <TextInput
            label="التاريخ"
            type="date"
            required
            min={today}
            value={date}
            onChange={(e) => {
              setDate(e.target.value);
              setWorkerId("");
              setFridayConfirmed(false);
            }}
          />
          <SelectInput
            label="الفترة"
            required
            value={shift}
            onChange={(e) => {
              setShift(e.target.value as Shift);
              setWorkerId("");
            }}
          >
            <option value="morning">صباحي</option>
            <option value="afternoon">مسائي</option>
          </SelectInput>
        </div>

        {friday && (
          <label className="flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 accent-amber-600"
              checked={fridayConfirmed}
              onChange={(e) => setFridayConfirmed(e.target.checked)}
            />
            <span>يوم الجمعة إجازة أسبوعية ثابتة. بتحديد هذا المربع أنشئ حجزاً استثنائياً لهذا اليوم.</span>
          </label>
        )}

        <SelectInput label="العاملة" required value={workerId} onChange={(e) => setWorkerId(e.target.value)}>
          <option value="">
            {eligibleWorkers.length === 0 ? "لا توجد عاملات متاحة لهذا الموعد" : "اختر العاملة"}
          </option>
          {eligibleWorkers.map(({ worker }) => (
            <option key={worker.id} value={worker.id}>
              {worker.name}
            </option>
          ))}
        </SelectInput>

        <TextInput
          label="المنطقة"
          required
          placeholder="اكتب اسم المنطقة"
          value={areaName}
          onChange={(e) => setAreaName(e.target.value)}
        />

        <div className="grid grid-cols-2 gap-3">
          <TextInput label="عدد الساعات" type="number" required min="0.5" step="0.5" value={hours} onChange={(e) => setHours(e.target.value)} />
          <TextInput label="المبلغ (د.ب)" type="number" required min="0" step="0.001" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>

        <TextInput label="اسم العميل" value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
        <TextInput label="هاتف العميل" type="tel" dir="ltr" className="text-right" value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} />
        <TextArea label="موقع العميل" value={customerLocation} onChange={(e) => setCustomerLocation(e.target.value)} />

        <Button type="submit" fullWidth size="lg" loading={loading}>
          حفظ الحجز
        </Button>
      </form>
    </div>
  );
}
