"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { SelectInput, TextInput } from "@/components/ui/Field";
import { Badge, EmptyState, ErrorBanner, Spinner } from "@/components/ui/Feedback";
import { usePolledFetch } from "@/hooks/usePolledFetch";
import { updateBookingPayment, ApiError } from "@/lib/booking";
import { formatDateAr, formatTimestampAr, weekdayLabelAr } from "@/lib/date";
import type { Booking, PaymentMethod, Shift } from "@/lib/types";

const SHIFT_LABEL: Record<Shift, string> = { morning: "صباحي", afternoon: "مسائي" };
const PAYMENT_LABEL: Record<PaymentMethod, string> = { benefit: "بنفت", cash: "نقدي" };

type PaymentFilter = "all" | "paid" | "unpaid" | "cash" | "benefit";

const FILTERS: { value: PaymentFilter; label: string }[] = [
  { value: "unpaid", label: "غير مدفوعة" },
  { value: "paid", label: "مدفوعة" },
  { value: "cash", label: "نقدي" },
  { value: "benefit", label: "بنفت" },
  { value: "all", label: "الكل" },
];

export default function PaymentsPage() {
  const [filter, setFilter] = useState<PaymentFilter>("unpaid");
  const { data, loading } = usePolledFetch(async () => {
    const res = await fetch(`/api/bookings/payments?filter=${filter}`);
    const json = (await res.json()) as { bookings?: Booking[] };
    return json.bookings ?? [];
  }, [filter]);
  const bookings = data ?? [];
  const [acting, setActing] = useState<Booking | null>(null);

  const totalAmount = bookings.reduce((sum, b) => sum + (b.paid ? (b.paidAmount ?? b.amount) : b.amount), 0);

  return (
    <div className="flex flex-1 flex-col gap-4">
      <h1 className="text-xl font-bold text-slate-900">المدفوعات</h1>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            className={`rounded-full border px-4 py-2 text-sm font-medium transition-colors ${
              filter === f.value
                ? "border-emerald-600 bg-emerald-600 text-white"
                : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {!loading && bookings.length > 0 && (
        <div className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-700">
          {bookings.length} حجز بإجمالي {totalAmount.toFixed(3)} د.ب
        </div>
      )}

      {loading ? (
        <Spinner />
      ) : bookings.length === 0 ? (
        <EmptyState message="لا يوجد حجوزات مطابقة" />
      ) : (
        <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
          <ul className="divide-y divide-slate-100">
            {bookings.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div>
                  <p className="font-medium text-slate-900">{b.workerName}</p>
                  <p className="text-sm text-slate-500">
                    {weekdayLabelAr(b.date)} {formatDateAr(b.date)} · {SHIFT_LABEL[b.shift]} · {b.areaName}
                  </p>
                  {b.paid ? (
                    <p className="text-xs text-slate-400">
                      {b.paymentMethod && PAYMENT_LABEL[b.paymentMethod]} ·{" "}
                      {b.paymentDate ? formatTimestampAr(new Date(b.paymentDate._seconds * 1000)) : ""} · سجّل
                      بواسطة {b.paymentBy === "manager" ? "المدير" : b.paymentBy}
                    </p>
                  ) : (
                    <p className="text-xs text-slate-400" dir="ltr">
                      {b.customerPhone}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <Badge color={b.paid ? "green" : "yellow"}>{b.paid ? "مدفوع" : "غير مدفوع"}</Badge>
                  <span className="font-semibold text-slate-800">
                    {(b.paid ? (b.paidAmount ?? b.amount) : b.amount).toFixed(3)} د.ب
                  </span>
                  <Button size="sm" onClick={() => setActing(b)}>
                    {b.paid ? "تعديل الدفع" : "تحديد كمدفوع"}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {acting && <PaymentActionModal booking={acting} onClose={() => setActing(null)} />}
    </div>
  );
}

function PaymentActionModal({ booking, onClose }: { booking: Booking; onClose: () => void }) {
  const [isPaid, setIsPaid] = useState(booking.paid);
  const [paymentMethod, setPaymentMethod] = useState<"" | PaymentMethod>(booking.paymentMethod ?? "cash");
  const [paidAmount, setPaidAmount] = useState(String(booking.paidAmount ?? booking.amount));
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleConfirm() {
    setError("");
    if (isPaid) {
      if (paymentMethod !== "benefit" && paymentMethod !== "cash") {
        setError("طريقة الدفع مطلوبة");
        return;
      }
      const amountNum = Number(paidAmount);
      if (paidAmount === "" || Number.isNaN(amountNum) || amountNum < 0) {
        setError("أدخل مبلغاً صحيحاً");
        return;
      }
    }
    setLoading(true);
    try {
      await updateBookingPayment(booking.id, {
        isPaid,
        paymentMethod: isPaid ? (paymentMethod as PaymentMethod) : null,
        paidAmount: isPaid ? Number(paidAmount) : null,
      });
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "تعذر تسجيل الدفع");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={`الدفع — ${booking.workerName}`}>
      <div className="space-y-4">
        <ErrorBanner message={error} />
        <p className="text-sm text-slate-600">
          مبلغ الحجز: <span className="font-semibold text-slate-900">{booking.amount.toFixed(3)} د.ب</span>
        </p>

        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            className="h-5 w-5 accent-emerald-600"
            checked={isPaid}
            onChange={(e) => setIsPaid(e.target.checked)}
          />
          <span className="text-sm font-medium text-slate-800">مدفوع</span>
        </label>

        {isPaid && (
          <>
            <SelectInput
              label="طريقة الدفع"
              required
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value as "" | PaymentMethod)}
            >
              <option value="">اختر طريقة الدفع</option>
              <option value="cash">نقدي</option>
              <option value="benefit">بنفت</option>
            </SelectInput>
            <TextInput
              label="المبلغ المدفوع (د.ب)"
              type="number"
              required
              min="0"
              step="0.001"
              value={paidAmount}
              onChange={(e) => setPaidAmount(e.target.value)}
            />
          </>
        )}

        <Button fullWidth loading={loading} onClick={handleConfirm}>
          حفظ
        </Button>
      </div>
    </Modal>
  );
}
