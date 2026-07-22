"use client";

import { useState, type FormEvent } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { TextInput, TextArea } from "@/components/ui/Field";
import { ErrorBanner } from "@/components/ui/Feedback";
import { ApiError, createBooking } from "@/lib/booking";
import { formatDateAr, weekdayLabelAr } from "@/lib/date";
import type { BookingSource, Shift, Worker } from "@/lib/types";

const SHIFT_LABEL: Record<Shift, string> = { morning: "صباحي", afternoon: "مسائي" };

/**
 * Payment is never captured here — booking creation stays free of any
 * payment concept at all. It's recorded later, exclusively from the
 * manager-only payment controls (see BookingDetailsModal).
 */
export function QuickBookingModal({
  open,
  onClose,
  worker,
  date,
  shift,
  source,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  worker: Worker;
  date: string;
  shift: Shift;
  source: BookingSource;
  onSuccess: () => void;
}) {
  const [areaName, setAreaName] = useState("");
  const [hours, setHours] = useState("");
  const [amount, setAmount] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerLocation, setCustomerLocation] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  function reset() {
    setAreaName("");
    setHours("");
    setAmount("");
    setCustomerPhone("");
    setCustomerLocation("");
    setError("");
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");

    const trimmedArea = areaName.trim();
    if (!trimmedArea) {
      setError("أدخل اسم المنطقة");
      return;
    }
    const hoursNum = Number(hours);
    const amountNum = Number(amount);
    if (!hoursNum || hoursNum <= 0) {
      setError("أدخل عدد ساعات صحيح");
      return;
    }
    if (Number.isNaN(amountNum) || amountNum < 0) {
      setError("أدخل مبلغاً صحيحاً");
      return;
    }

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
        customerPhone,
        customerLocation,
        source,
        recurringSeriesId: null,
      });
      reset();
      onSuccess();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "تعذر حفظ الحجز، حاول مرة أخرى");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      title={`حجز جديد — ${worker.name}`}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <ErrorBanner message={error} />
        <div className="rounded-xl bg-slate-50 p-3 text-sm text-slate-600">
          <p>
            <span className="font-medium text-slate-800">{weekdayLabelAr(date)}</span>{" "}
            {formatDateAr(date)} · {SHIFT_LABEL[shift]}
          </p>
        </div>

        <TextInput
          label="المنطقة"
          required
          placeholder="اكتب اسم المنطقة"
          value={areaName}
          onChange={(e) => setAreaName(e.target.value)}
        />

        <div className="grid grid-cols-2 gap-3">
          <TextInput
            label="عدد الساعات"
            type="number"
            required
            min="0.5"
            step="0.5"
            inputMode="decimal"
            value={hours}
            onChange={(e) => setHours(e.target.value)}
          />
          <TextInput
            label="المبلغ (د.ب)"
            type="number"
            required
            min="0"
            step="0.001"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>

        <TextInput
          label="هاتف العميل"
          type="tel"
          dir="ltr"
          className="text-right"
          value={customerPhone}
          onChange={(e) => setCustomerPhone(e.target.value)}
        />
        <TextArea
          label="موقع العميل"
          value={customerLocation}
          onChange={(e) => setCustomerLocation(e.target.value)}
        />

        <Button type="submit" fullWidth size="lg" loading={loading}>
          حفظ الحجز
        </Button>
      </form>
    </Modal>
  );
}
