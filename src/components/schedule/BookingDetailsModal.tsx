"use client";

import { useState, type FormEvent } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { SelectInput, TextArea, TextInput } from "@/components/ui/Field";
import { ErrorBanner } from "@/components/ui/Feedback";
import { useManagerSession } from "@/context/ManagerSessionContext";
import {
  ApiError,
  cancelBooking,
  updateBookingFields,
  updateBookingPayment,
  type EditableBookingFields,
  type PaymentPatch,
} from "@/lib/booking";
import { formatDateAr, formatTimestampAr, weekdayLabelAr } from "@/lib/date";
import { mapsLinkFor } from "@/lib/maps";
import {
  cancelRecurringOccurrence,
  editRecurringOccurrence,
  setRecurringOccurrencePayment,
  type RecurringCancelScope,
  type RecurringEditScope,
} from "@/lib/recurring";
import type { Booking, CellResolution, PaymentMethod, RecurringSchedule, Shift, Worker } from "@/lib/types";

const SHIFT_LABEL: Record<Shift, string> = { morning: "صباحي", afternoon: "مسائي" };

type View = "details" | "edit" | "cancelSingle" | "editRecurringScope" | "cancelRecurringScope";

/**
 * A virtual (not-yet-materialized) recurring occurrence has no Booking
 * document yet, so it has no payment record either — it reads as plainly
 * unpaid until a manager actually acts on it, at which point the payment
 * panel materializes it server-side (see setRecurringOccurrencePayment).
 */
const UNPAID_VIRTUAL_PAYMENT = {
  paid: false as const,
  paymentMethod: null,
  paidAmount: null,
  paymentDate: null,
  paymentBy: null,
};

export function BookingDetailsModal({
  open,
  onClose,
  worker,
  workers,
  date,
  shift,
  resolution,
  recurringSchedules,
  initialView = "details",
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  worker: Worker;
  /** Manager only — lets EditForm offer "Change worker" for a plain booking. */
  workers: Worker[];
  date: string;
  shift: Shift;
  resolution: CellResolution;
  recurringSchedules: RecurringSchedule[];
  /** Opens straight into a specific view (e.g. a direct "Delete" entry point) instead of the details screen. */
  initialView?: View;
  onSuccess: () => void;
}) {
  const { isManager } = useManagerSession();
  const [view, setView] = useState<View>(initialView);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const booking: Booking | null = resolution.booking;
  const recurring: RecurringSchedule | null =
    resolution.virtualOccurrence?.recurring ??
    (booking?.recurringSeriesId ? recurringSchedules.find((r) => r.id === booking.recurringSeriesId) ?? null : null);
  const isRecurring = recurring !== null;

  const displayFields = booking ?? {
    areaName: recurring!.areaName,
    hours: recurring!.hours,
    amount: recurring!.amount,
    customerName: recurring!.customerName,
    customerPhone: recurring!.customerPhone,
    customerLocation: recurring!.customerLocation,
  };
  const payment = booking ?? UNPAID_VIRTUAL_PAYMENT;

  function close() {
    setView("details");
    setError("");
    onClose();
  }

  async function savePayment(patch: PaymentPatch) {
    if (booking) {
      await updateBookingPayment(booking.id, patch);
    } else {
      await setRecurringOccurrencePayment({ recurring: recurring!, date, payment: patch });
    }
    onSuccess();
  }

  return (
    <Modal open={open} onClose={close} title={`تفاصيل الحجز — ${worker.name}`}>
      {view === "details" && (
        <div className="space-y-4">
          <ErrorBanner message={error} />
          <div className="rounded-xl bg-slate-50 p-3 text-sm text-slate-600">
            {weekdayLabelAr(date)} {formatDateAr(date)} · {SHIFT_LABEL[shift]}
          </div>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            {displayFields.customerName && (
              <Field label="اسم العميل" value={displayFields.customerName} />
            )}
            <Field label="المنطقة" value={displayFields.areaName} />
            <Field label="الساعات" value={String(displayFields.hours)} />
            {/* Amount is financial information, same as payment status — manager only. */}
            {isManager && <Field label="المبلغ" value={`${displayFields.amount} د.ب`} />}
            {displayFields.customerPhone && (
              <Field label="هاتف العميل" value={displayFields.customerPhone} dir="ltr" />
            )}
            {displayFields.customerLocation && (
              <div>
                <dt className="text-xs text-slate-500">الموقع</dt>
                <dd>
                  <a
                    href={mapsLinkFor(displayFields.customerLocation)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-sky-600 underline hover:text-sky-800"
                  >
                    {displayFields.customerLocation}
                  </a>
                </dd>
              </div>
            )}
          </dl>

          {/* Display recurrence type: one-time booking vs part of a repeating weekly schedule. */}
          <div className="rounded-xl bg-sky-50 px-3 py-2 text-xs text-sky-800">
            {isRecurring
              ? `نوع الحجز: تكرار أسبوعي${!isManager ? " (يُدار من قبل المدير)" : ""}`
              : "نوع الحجز: لهذا الأسبوع فقط"}
          </div>

          {/*
            Employees never see anything about payment status — not a
            field, not a badge, nothing. This panel only renders at all
            for a manager session.
          */}
          {isManager && (
            <PaymentPanel key={booking?.id ?? `${recurring?.id}_${date}`} payment={payment} onSave={savePayment} />
          )}

          {/*
            Edit/cancel are manager-only, full stop — a plain (non-recurring)
            booking used to be editable by whoever created it, but booking
            management is no longer an employee capability at all.
          */}
          {isManager && (
            <div className="flex gap-3 pt-2">
              <Button
                variant="secondary"
                fullWidth
                onClick={() => setView(isRecurring ? "editRecurringScope" : "edit")}
              >
                تعديل
              </Button>
              <Button
                variant="danger"
                fullWidth
                onClick={() => setView(isRecurring ? "cancelRecurringScope" : "cancelSingle")}
              >
                إلغاء الحجز
              </Button>
            </div>
          )}
        </div>
      )}

      {view === "edit" && booking && (
        <EditForm
          initial={booking}
          workers={workers}
          loading={loading}
          error={error}
          onCancel={() => setView("details")}
          onSubmit={async (fields) => {
            setLoading(true);
            setError("");
            try {
              await updateBookingFields(booking.id, fields);
              onSuccess();
              close();
            } catch (err) {
              setError(err instanceof ApiError ? err.message : "تعذر حفظ التعديل");
            } finally {
              setLoading(false);
            }
          }}
        />
      )}

      {view === "cancelSingle" && booking && (
        <CancelSingleForm
          loading={loading}
          error={error}
          onBack={() => setView("details")}
          onConfirm={async (reason) => {
            setLoading(true);
            setError("");
            try {
              await cancelBooking(booking.id, { reason, cancelScope: "single" });
              onSuccess();
              close();
            } catch (err) {
              setError(err instanceof ApiError ? err.message : "تعذر إلغاء الحجز");
            } finally {
              setLoading(false);
            }
          }}
        />
      )}

      {view === "editRecurringScope" && recurring && (
        <RecurringEditForm
          initial={displayFields}
          loading={loading}
          error={error}
          onCancel={() => setView("details")}
          onSubmit={async (scope, fields) => {
            setLoading(true);
            setError("");
            try {
              await editRecurringOccurrence({
                recurring,
                date,
                scope,
                fields,
              });
              onSuccess();
              close();
            } catch (err) {
              setError(err instanceof ApiError ? err.message : "تعذر حفظ التعديل");
            } finally {
              setLoading(false);
            }
          }}
        />
      )}

      {view === "cancelRecurringScope" && recurring && (
        <RecurringCancelForm
          loading={loading}
          error={error}
          onBack={() => setView("details")}
          onConfirm={async (scope, reason) => {
            setLoading(true);
            setError("");
            try {
              await cancelRecurringOccurrence({ recurring, date, scope, reason });
              onSuccess();
              close();
            } catch (err) {
              setError(err instanceof ApiError ? err.message : "تعذر إلغاء الموعد");
            } finally {
              setLoading(false);
            }
          }}
        />
      )}
    </Modal>
  );
}

function Field({ label, value, dir }: { label: string; value: string; dir?: "ltr" | "rtl" }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="font-medium text-slate-800" dir={dir}>
        {value || "—"}
      </dd>
    </div>
  );
}

/**
 * The Manager Payment Tracking module's core control: a Paid checkbox that
 * reveals a required payment method + editable paid amount when checked,
 * and clears both (server-side, regardless of what's left in these local
 * fields) when unchecked. Payment date and "recorded by" are read-only,
 * server-derived, and only ever shown once a booking is actually paid.
 */
function PaymentPanel({
  payment,
  onSave,
}: {
  payment: {
    paid: boolean;
    paymentMethod: PaymentMethod | null;
    paidAmount: number | null;
    paymentDate: Booking["paymentDate"];
    paymentBy: string | null;
  };
  onSave: (patch: PaymentPatch) => Promise<void>;
}) {
  const [isPaid, setIsPaid] = useState(payment.paid);
  const [paymentMethod, setPaymentMethod] = useState<"" | PaymentMethod>(payment.paymentMethod ?? "");
  const [paidAmount, setPaidAmount] = useState(payment.paidAmount != null ? String(payment.paidAmount) : "");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);

  const dirty =
    isPaid !== payment.paid ||
    (isPaid && ((paymentMethod || null) !== payment.paymentMethod || paidAmount !== String(payment.paidAmount ?? "")));

  function togglePaid(next: boolean) {
    setIsPaid(next);
    setSaved(false);
    if (next && !paidAmount) setPaidAmount(""); // manager fills it in explicitly
  }

  async function handleSave() {
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
      await onSave({
        isPaid,
        paymentMethod: isPaid ? (paymentMethod as PaymentMethod) : null,
        paidAmount: isPaid ? Number(paidAmount) : null,
      });
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "تعذر تسجيل الدفع");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-3 rounded-xl border border-slate-200 p-3">
      <p className="text-xs font-semibold text-slate-500">حالة الدفع</p>
      <ErrorBanner message={error} />

      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          className="h-5 w-5 accent-emerald-600"
          checked={isPaid}
          onChange={(e) => togglePaid(e.target.checked)}
        />
        <span className="text-sm font-medium text-slate-800">مدفوع</span>
      </label>

      {isPaid && (
        <div className="grid grid-cols-2 gap-3">
          <SelectInput
            label="طريقة الدفع"
            required
            value={paymentMethod}
            onChange={(e) => {
              setPaymentMethod(e.target.value as "" | PaymentMethod);
              setSaved(false);
            }}
          >
            <option value="">اختر طريقة الدفع</option>
            <option value="benefit">بنفت</option>
            <option value="cash">نقدي</option>
          </SelectInput>
          <TextInput
            label="المبلغ المدفوع (د.ب)"
            type="number"
            required
            min="0"
            step="0.001"
            value={paidAmount}
            onChange={(e) => {
              setPaidAmount(e.target.value);
              setSaved(false);
            }}
          />
        </div>
      )}

      {payment.paid && (
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <Field
            label="تاريخ الدفع"
            value={payment.paymentDate ? formatTimestampAr(new Date(payment.paymentDate._seconds * 1000)) : ""}
          />
          <Field label="سجّل بواسطة" value={payment.paymentBy === "manager" ? "المدير" : payment.paymentBy || ""} />
        </dl>
      )}

      <Button size="sm" onClick={handleSave} loading={loading} disabled={!dirty || saved}>
        حفظ حالة الدفع
      </Button>
      {saved && <p className="text-xs text-emerald-700">تم الحفظ.</p>}
    </div>
  );
}

function EditForm({
  initial,
  workers,
  loading,
  error,
  onCancel,
  onSubmit,
}: {
  initial: Booking;
  workers: Worker[];
  loading: boolean;
  error: string;
  onCancel: () => void;
  onSubmit: (fields: EditableBookingFields) => void;
}) {
  const [date, setDate] = useState(initial.date);
  const [workerId, setWorkerId] = useState(initial.workerId);
  const [areaName, setAreaName] = useState(initial.areaName);
  const [hours, setHours] = useState(String(initial.hours));
  const [amount, setAmount] = useState(String(initial.amount));
  const [customerName, setCustomerName] = useState(initial.customerName);
  const [customerPhone, setCustomerPhone] = useState(initial.customerPhone);
  const [customerLocation, setCustomerLocation] = useState(initial.customerLocation);
  const [localError, setLocalError] = useState("");

  // The current worker might be inactive; keep them selectable so the form
  // doesn't silently drop the existing assignment out from under the manager.
  const workerOptions = workers.some((w) => w.id === initial.workerId)
    ? workers.filter((w) => w.active || w.id === initial.workerId)
    : [{ id: initial.workerId, name: initial.workerName } as Worker, ...workers.filter((w) => w.active)];

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmedArea = areaName.trim();
    const hoursNum = Number(hours);
    const amountNum = Number(amount);
    const selectedWorker = workerOptions.find((w) => w.id === workerId);
    if (!date) return setLocalError("اختر التاريخ");
    if (!selectedWorker) return setLocalError("اختر العاملة");
    if (!trimmedArea) return setLocalError("أدخل اسم المنطقة");
    if (!hoursNum || hoursNum <= 0) return setLocalError("أدخل عدد ساعات صحيح");
    if (Number.isNaN(amountNum) || amountNum < 0) return setLocalError("أدخل مبلغاً صحيحاً");
    setLocalError("");
    onSubmit({
      areaId: trimmedArea,
      areaName: trimmedArea,
      hours: hoursNum,
      amount: amountNum,
      customerName,
      customerPhone,
      customerLocation,
      date,
      workerId: selectedWorker.id,
      workerName: selectedWorker.name,
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <ErrorBanner message={error || localError} />
      <div className="grid grid-cols-2 gap-3">
        <TextInput label="التاريخ" type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
        <SelectInput label="العاملة" required value={workerId} onChange={(e) => setWorkerId(e.target.value)}>
          {workerOptions.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </SelectInput>
      </div>
      <TextInput
        label="المنطقة"
        required
        placeholder="اكتب اسم المنطقة"
        value={areaName}
        onChange={(e) => setAreaName(e.target.value)}
      />
      <div className="grid grid-cols-2 gap-3">
        <TextInput label="عدد الساعات" type="number" min="0.5" step="0.5" value={hours} onChange={(e) => setHours(e.target.value)} />
        <TextInput label="المبلغ (د.ب)" type="number" min="0" step="0.001" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </div>
      <TextInput label="اسم العميل" value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
      <TextInput label="هاتف العميل" type="tel" dir="ltr" className="text-right" value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} />
      <TextArea label="موقع العميل" value={customerLocation} onChange={(e) => setCustomerLocation(e.target.value)} />
      <div className="flex gap-3">
        <Button type="button" variant="secondary" fullWidth onClick={onCancel}>
          رجوع
        </Button>
        <Button type="submit" fullWidth loading={loading}>
          حفظ
        </Button>
      </div>
    </form>
  );
}

function CancelSingleForm({
  loading,
  error,
  onBack,
  onConfirm,
}: {
  loading: boolean;
  error: string;
  onBack: () => void;
  onConfirm: (reason: string | null) => void;
}) {
  const [reason, setReason] = useState("");
  return (
    <div className="space-y-4">
      <ErrorBanner message={error} />
      <p className="text-slate-700">هل تريد بالتأكيد إلغاء هذا الحجز؟</p>
      <TextArea label="سبب الإلغاء (اختياري)" value={reason} onChange={(e) => setReason(e.target.value)} />
      <div className="flex gap-3">
        <Button variant="secondary" fullWidth onClick={onBack} disabled={loading}>
          رجوع
        </Button>
        <Button variant="danger" fullWidth loading={loading} onClick={() => onConfirm(reason || null)}>
          تأكيد الإلغاء
        </Button>
      </div>
    </div>
  );
}

function RecurringEditForm({
  initial,
  loading,
  error,
  onCancel,
  onSubmit,
}: {
  initial: {
    areaName: string;
    hours: number;
    amount: number;
    customerName?: string;
    customerPhone?: string;
    customerLocation?: string;
  };
  loading: boolean;
  error: string;
  onCancel: () => void;
  onSubmit: (scope: RecurringEditScope, fields: EditableBookingFields) => void;
}) {
  const [scope, setScope] = useState<RecurringEditScope>("single");
  const [areaName, setAreaName] = useState(initial.areaName ?? "");
  const [hours, setHours] = useState(String(initial.hours));
  const [amount, setAmount] = useState(String(initial.amount));
  const [customerName, setCustomerName] = useState(initial.customerName ?? "");
  const [customerPhone, setCustomerPhone] = useState(initial.customerPhone ?? "");
  const [customerLocation, setCustomerLocation] = useState(initial.customerLocation ?? "");
  const [localError, setLocalError] = useState("");

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmedArea = areaName.trim();
    const hoursNum = Number(hours);
    const amountNum = Number(amount);
    if (!trimmedArea) return setLocalError("أدخل اسم المنطقة");
    if (!hoursNum || hoursNum <= 0) return setLocalError("أدخل عدد ساعات صحيح");
    if (Number.isNaN(amountNum) || amountNum < 0) return setLocalError("أدخل مبلغاً صحيحاً");
    setLocalError("");
    onSubmit(scope, {
      areaId: trimmedArea,
      areaName: trimmedArea,
      hours: hoursNum,
      amount: amountNum,
      customerName,
      customerPhone,
      customerLocation,
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <ErrorBanner message={error || localError} />
      <ScopeRadios
        value={scope}
        onChange={setScope}
        options={[
          { value: "single", label: "هذا الموعد فقط" },
          { value: "forward", label: "من هذا التاريخ فصاعدًا" },
          { value: "entire", label: "الجدول المتكرر كاملًا" },
        ]}
      />
      <TextInput
        label="المنطقة"
        required
        placeholder="اكتب اسم المنطقة"
        value={areaName}
        onChange={(e) => setAreaName(e.target.value)}
      />
      <div className="grid grid-cols-2 gap-3">
        <TextInput label="عدد الساعات" type="number" min="0.5" step="0.5" value={hours} onChange={(e) => setHours(e.target.value)} />
        <TextInput label="المبلغ (د.ب)" type="number" min="0" step="0.001" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </div>
      <TextInput label="اسم العميل" value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
      <TextInput label="هاتف العميل" type="tel" dir="ltr" className="text-right" value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} />
      <TextArea label="موقع العميل" value={customerLocation} onChange={(e) => setCustomerLocation(e.target.value)} />
      <div className="flex gap-3">
        <Button type="button" variant="secondary" fullWidth onClick={onCancel}>
          رجوع
        </Button>
        <Button type="submit" fullWidth loading={loading}>
          حفظ
        </Button>
      </div>
    </form>
  );
}

function RecurringCancelForm({
  loading,
  error,
  onBack,
  onConfirm,
}: {
  loading: boolean;
  error: string;
  onBack: () => void;
  onConfirm: (scope: RecurringCancelScope, reason: string | null) => void;
}) {
  const [scope, setScope] = useState<RecurringCancelScope>("single");
  const [reason, setReason] = useState("");
  return (
    <div className="space-y-4">
      <ErrorBanner message={error} />
      <ScopeRadios
        value={scope}
        onChange={setScope}
        options={[
          { value: "single", label: "إلغاء هذا التاريخ فقط" },
          { value: "forward", label: "إلغاء من هذا التاريخ فصاعدًا" },
        ]}
      />
      <TextArea label="سبب الإلغاء (اختياري)" value={reason} onChange={(e) => setReason(e.target.value)} />
      <div className="flex gap-3">
        <Button variant="secondary" fullWidth onClick={onBack} disabled={loading}>
          رجوع
        </Button>
        <Button variant="danger" fullWidth loading={loading} onClick={() => onConfirm(scope, reason || null)}>
          تأكيد الإلغاء
        </Button>
      </div>
    </div>
  );
}

function ScopeRadios<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div className="space-y-2 rounded-xl border border-slate-200 p-3">
      {options.map((opt) => (
        <label key={opt.value} className="flex cursor-pointer items-center gap-2 py-1">
          <input
            type="radio"
            checked={value === opt.value}
            onChange={() => onChange(opt.value)}
            className="h-4 w-4 accent-emerald-600"
          />
          <span className="text-sm text-slate-800">{opt.label}</span>
        </label>
      ))}
    </div>
  );
}
