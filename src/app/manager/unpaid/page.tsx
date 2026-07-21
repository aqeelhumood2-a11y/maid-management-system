"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { SelectInput } from "@/components/ui/Field";
import { EmptyState, ErrorBanner, Spinner } from "@/components/ui/Feedback";
import { usePolledFetch } from "@/hooks/usePolledFetch";
import { formatDateAr, weekdayLabelAr } from "@/lib/date";
import { ApiError, markBookingPaid } from "@/lib/booking";
import type { Booking, PaymentMethod, Shift } from "@/lib/types";

const SHIFT_LABEL: Record<Shift, string> = { morning: "صباحي", afternoon: "مسائي" };

export default function UnpaidBookingsPage() {
  const { data, loading } = usePolledFetch(async () => {
    const res = await fetch("/api/bookings?unpaid=true");
    const json = (await res.json()) as { bookings?: Booking[] };
    return json.bookings ?? [];
  }, []);
  const bookings = data ?? [];
  const [marking, setMarking] = useState<Booking | null>(null);

  const totalAmount = bookings.reduce((sum, b) => sum + b.amount, 0);

  return (
    <div className="flex flex-1 flex-col gap-4">
      <h1 className="text-xl font-bold text-slate-900">المدفوعات المعلقة</h1>

      {!loading && bookings.length > 0 && (
        <div className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {bookings.length} حجز غير مدفوع بإجمالي {totalAmount.toFixed(3)} د.ب
        </div>
      )}

      {loading ? (
        <Spinner />
      ) : bookings.length === 0 ? (
        <EmptyState message="لا يوجد مدفوعات معلقة" />
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
                  <p className="text-xs text-slate-400" dir="ltr">
                    {b.customerPhone}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-semibold text-slate-800">{b.amount.toFixed(3)} د.ب</span>
                  <Button size="sm" onClick={() => setMarking(b)}>
                    تحديد كمدفوع
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {marking && <MarkPaidModal booking={marking} onClose={() => setMarking(null)} />}
    </div>
  );
}

function MarkPaidModal({ booking, onClose }: { booking: Booking; onClose: () => void }) {
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleConfirm() {
    setLoading(true);
    setError("");
    try {
      await markBookingPaid(booking.id, { paymentMethod });
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "تعذر تسجيل الدفع");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={`تسجيل الدفع — ${booking.workerName}`}>
      <div className="space-y-4">
        <ErrorBanner message={error} />
        <p className="text-sm text-slate-600">
          المبلغ: <span className="font-semibold text-slate-900">{booking.amount.toFixed(3)} د.ب</span>
        </p>
        <SelectInput
          label="طريقة الدفع"
          value={paymentMethod}
          onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
        >
          <option value="cash">نقدي</option>
          <option value="benefit">بنفت</option>
        </SelectInput>
        <Button fullWidth loading={loading} onClick={handleConfirm}>
          تأكيد الدفع
        </Button>
      </div>
    </Modal>
  );
}
