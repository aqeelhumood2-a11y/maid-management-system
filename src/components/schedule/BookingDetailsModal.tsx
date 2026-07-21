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
  type EditableBookingFields,
} from "@/lib/booking";
import { formatDateAr, weekdayLabelAr } from "@/lib/date";
import {
  cancelRecurringOccurrence,
  editRecurringOccurrence,
  type RecurringCancelScope,
  type RecurringEditScope,
} from "@/lib/recurring";
import type { Booking, CellResolution, PaymentMethod, RecurringSchedule, Shift, Worker } from "@/lib/types";

const SHIFT_LABEL: Record<Shift, string> = { morning: "صباحي", afternoon: "مسائي" };
const PAYMENT_LABEL: Record<string, string> = { benefit: "بنفت", cash: "نقدي" };

type View = "details" | "edit" | "cancelSingle" | "editRecurringScope" | "cancelRecurringScope";

export function BookingDetailsModal({
  open,
  onClose,
  worker,
  date,
  shift,
  resolution,
  recurringSchedules,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  worker: Worker;
  date: string;
  shift: Shift;
  resolution: CellResolution;
  recurringSchedules: RecurringSchedule[];
  onSuccess: () => void;
}) {
  const { isManager } = useManagerSession();
  const [view, setView] = useState<View>("details");
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
    paymentMethod: recurring!.paymentMethod,
    customerPhone: recurring!.customerPhone,
    customerLocation: recurring!.customerLocation,
    paid: recurring!.paymentMethod !== null,
  };

  function close() {
    setView("details");
    setError("");
    onClose();
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
            <Field label="المنطقة" value={displayFields.areaName} />
            <Field label="الساعات" value={String(displayFields.hours)} />
            <Field label="المبلغ" value={`${displayFields.amount} د.ب`} />
            <Field
              label="الدفع"
              value={displayFields.paymentMethod ? PAYMENT_LABEL[displayFields.paymentMethod] : "غير مدفوع"}
            />
            {"customerPhone" in displayFields && displayFields.customerPhone && (
              <Field label="هاتف العميل" value={displayFields.customerPhone} dir="ltr" />
            )}
            {"customerLocation" in displayFields && displayFields.customerLocation && (
              <Field label="الموقع" value={displayFields.customerLocation} />
            )}
          </dl>

          {isRecurring && (
            <div className="rounded-xl bg-sky-50 px-3 py-2 text-xs text-sky-800">
              هذا حجز ضمن جدول متكرر أسبوعي
              {!isManager ? " ويُدار من قبل المدير." : "."}
            </div>
          )}

          {(!isRecurring || isManager) && (
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

function EditForm({
  initial,
  loading,
  error,
  onCancel,
  onSubmit,
}: {
  initial: Booking;
  loading: boolean;
  error: string;
  onCancel: () => void;
  onSubmit: (fields: EditableBookingFields) => void;
}) {
  const [areaName, setAreaName] = useState(initial.areaName);
  const [hours, setHours] = useState(String(initial.hours));
  const [amount, setAmount] = useState(String(initial.amount));
  const [paymentMethod, setPaymentMethod] = useState<"" | PaymentMethod>(initial.paymentMethod ?? "");
  const [customerPhone, setCustomerPhone] = useState(initial.customerPhone);
  const [customerLocation, setCustomerLocation] = useState(initial.customerLocation);
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
    onSubmit({
      areaId: trimmedArea,
      areaName: trimmedArea,
      hours: hoursNum,
      amount: amountNum,
      paymentMethod: paymentMethod || null,
      customerPhone,
      customerLocation,
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <ErrorBanner message={error || localError} />
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
      <SelectInput label="طريقة الدفع" value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value as "" | PaymentMethod)}>
        <option value="">بدون دفع (غير مدفوع)</option>
        <option value="benefit">بنفت</option>
        <option value="cash">نقدي</option>
      </SelectInput>
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
  initial: { areaName: string; hours: number; amount: number; paymentMethod: PaymentMethod | null; customerPhone?: string; customerLocation?: string };
  loading: boolean;
  error: string;
  onCancel: () => void;
  onSubmit: (scope: RecurringEditScope, fields: EditableBookingFields) => void;
}) {
  const [scope, setScope] = useState<RecurringEditScope>("single");
  const [areaName, setAreaName] = useState(initial.areaName ?? "");
  const [hours, setHours] = useState(String(initial.hours));
  const [amount, setAmount] = useState(String(initial.amount));
  const [paymentMethod, setPaymentMethod] = useState<"" | PaymentMethod>(initial.paymentMethod ?? "");
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
      paymentMethod: paymentMethod || null,
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
      <SelectInput label="طريقة الدفع" value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value as "" | PaymentMethod)}>
        <option value="">بدون دفع (غير مدفوع)</option>
        <option value="benefit">بنفت</option>
        <option value="cash">نقدي</option>
      </SelectInput>
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
