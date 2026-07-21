"use client";

import { useState, type FormEvent } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { TextInput, SelectInput, TextArea } from "@/components/ui/Field";
import { ErrorBanner } from "@/components/ui/Feedback";
import { useAuth } from "@/context/AuthContext";
import { useAreas } from "@/hooks/useAreas";
import { BookingConflictError, createBooking } from "@/lib/booking";
import { formatDateAr, weekdayLabelAr } from "@/lib/date";
import { getDb } from "@/lib/firebase/client";
import type { BookingSource, PaymentMethod, Shift, Worker } from "@/lib/types";

const SHIFT_LABEL: Record<Shift, string> = { morning: "صباحي", afternoon: "مسائي" };

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
  const { actingUser } = useAuth();
  const { areas } = useAreas();
  const activeAreas = areas.filter((a) => a.active);

  const [areaId, setAreaId] = useState("");
  const [hours, setHours] = useState("");
  const [amount, setAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"" | PaymentMethod>("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerLocation, setCustomerLocation] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  function reset() {
    setAreaId("");
    setHours("");
    setAmount("");
    setPaymentMethod("");
    setCustomerPhone("");
    setCustomerLocation("");
    setError("");
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");

    const area = activeAreas.find((a) => a.id === areaId);
    if (!area) {
      setError("اختر المنطقة");
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
      await createBooking(getDb(), {
        date,
        shift,
        workerId: worker.id,
        workerName: worker.name,
        areaId: area.id,
        areaName: area.name,
        hours: hoursNum,
        amount: amountNum,
        paymentMethod: paymentMethod || null,
        customerPhone,
        customerLocation,
        source,
        recurringSeriesId: null,
        actingUser,
      });
      reset();
      onSuccess();
      onClose();
    } catch (err) {
      if (err instanceof BookingConflictError) {
        setError(err.message);
      } else {
        setError("تعذر حفظ الحجز، حاول مرة أخرى");
      }
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

        <SelectInput label="المنطقة" required value={areaId} onChange={(e) => setAreaId(e.target.value)}>
          <option value="">اختر المنطقة</option>
          {activeAreas.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </SelectInput>

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

        <SelectInput
          label="طريقة الدفع"
          value={paymentMethod}
          onChange={(e) => setPaymentMethod(e.target.value as "" | PaymentMethod)}
        >
          <option value="">بدون دفع (غير مدفوع)</option>
          <option value="benefit">بنفت</option>
          <option value="cash">نقدي</option>
        </SelectInput>

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
