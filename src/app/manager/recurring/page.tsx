"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { SelectInput, TextArea, TextInput } from "@/components/ui/Field";
import { ErrorBanner, Spinner, SuccessBanner } from "@/components/ui/Feedback";
import { useWorkers } from "@/hooks/useWorkers";
import { useRecurringSchedules } from "@/hooks/useRecurring";
import { dayOfWeek, todayBahrain, weekdayLabelAr } from "@/lib/date";
import { ApiError } from "@/lib/booking";
import {
  availableDaysOfWeek,
  cancelRecurringOccurrence,
  createRecurringSchedule,
  editRecurringOccurrence,
  type RecurringCancelScope,
  type RecurringEditScope,
} from "@/lib/recurring";
import type { RecurringSchedule, Shift } from "@/lib/types";

const SHIFT_LABEL: Record<Shift, string> = { morning: "صباحي", afternoon: "مسائي" };

export default function RecurringPage() {
  const { schedules, loading } = useRecurringSchedules();
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<RecurringSchedule | null>(null);
  const [cancelling, setCancelling] = useState<RecurringSchedule | null>(null);

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-900">الجدول المتكرر</h1>
        <Button onClick={() => setAddOpen(true)}>+ إضافة موعد متكرر</Button>
      </div>

      {loading ? (
        <Spinner />
      ) : (
        <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
          <ul className="divide-y divide-slate-100">
            {schedules.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div>
                  <p className="font-medium text-slate-900">
                    {s.workerName} — {weekdayLabelAr(nextIsoForDow(s.dayOfWeek))} · {SHIFT_LABEL[s.shift]}
                  </p>
                  <p className="text-sm text-slate-500">
                    {s.areaName} · {s.hours} ساعة · {s.amount} د.ب
                  </p>
                  <p className="text-xs text-slate-400">
                    الدفع يُدار بشكل مستقل لكل موعد من جدول اليوم/الأسبوع
                  </p>
                  <p className="text-xs text-slate-400">
                    من {s.startDate} {s.endDate ? `إلى ${s.endDate}` : "(مستمر)"}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" onClick={() => setEditing(s)}>
                    تعديل
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => setCancelling(s)}>
                    إلغاء
                  </Button>
                </div>
              </li>
            ))}
            {schedules.length === 0 && (
              <li className="px-4 py-8 text-center text-sm text-slate-500">لا يوجد جدول متكرر حالياً</li>
            )}
          </ul>
        </div>
      )}

      {addOpen && <AddRecurringModal onClose={() => setAddOpen(false)} />}
      {editing && <EditRecurringModal recurring={editing} onClose={() => setEditing(null)} />}
      {cancelling && <CancelRecurringModal recurring={cancelling} onClose={() => setCancelling(null)} />}
    </div>
  );
}

function nextIsoForDow(dow: number): string {
  const today = todayBahrain();
  for (let i = 0; i < 7; i++) {
    const d = new Date(`${today}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + i);
    if (d.getUTCDay() === dow) return d.toISOString().slice(0, 10);
  }
  return today;
}

function AddRecurringModal({ onClose }: { onClose: () => void }) {
  const { workers } = useWorkers();
  const activeWorkers = workers.filter((w) => w.active);
  const days = availableDaysOfWeek();

  const [workerId, setWorkerId] = useState("");
  const [areaName, setAreaName] = useState("");
  const [shift, setShift] = useState<Shift>("morning");
  const [day, setDay] = useState(days[0].value);
  const [hours, setHours] = useState("");
  const [amount, setAmount] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerLocation, setCustomerLocation] = useState("");
  const [startDate, setStartDate] = useState(todayBahrain());
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const worker = activeWorkers.find((w) => w.id === workerId);
    const trimmedArea = areaName.trim();
    const hoursNum = Number(hours);
    const amountNum = Number(amount);
    if (!worker) return setError("اختر العاملة");
    if (!trimmedArea) return setError("أدخل اسم المنطقة");
    if (!hoursNum || hoursNum <= 0) return setError("أدخل عدد ساعات صحيح");
    if (Number.isNaN(amountNum) || amountNum < 0) return setError("أدخل مبلغاً صحيحاً");

    setLoading(true);
    setError("");
    try {
      await createRecurringSchedule({
        workerId: worker.id,
        workerName: worker.name,
        areaId: trimmedArea,
        areaName: trimmedArea,
        shift,
        dayOfWeek: day,
        hours: hoursNum,
        amount: amountNum,
        customerPhone,
        customerLocation,
        startDate,
      });
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "تعذر إنشاء الجدول المتكرر");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="إضافة موعد متكرر">
      <form onSubmit={handleSubmit} className="space-y-4">
        <ErrorBanner message={error} />
        <SelectInput label="العاملة" required value={workerId} onChange={(e) => setWorkerId(e.target.value)}>
          <option value="">اختر العاملة</option>
          {activeWorkers.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
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
          <SelectInput label="اليوم" required value={day} onChange={(e) => setDay(Number(e.target.value))}>
            {days.map((d) => (
              <option key={d.value} value={d.value}>
                {d.labelAr}
              </option>
            ))}
          </SelectInput>
          <SelectInput label="الفترة" required value={shift} onChange={(e) => setShift(e.target.value as Shift)}>
            <option value="morning">صباحي</option>
            <option value="afternoon">مسائي</option>
          </SelectInput>
        </div>
        <TextInput label="تاريخ البدء" type="date" required min={todayBahrain()} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        <div className="grid grid-cols-2 gap-3">
          <TextInput label="عدد الساعات" type="number" required min="0.5" step="0.5" value={hours} onChange={(e) => setHours(e.target.value)} />
          <TextInput label="المبلغ (د.ب)" type="number" required min="0" step="0.001" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
        <TextInput label="هاتف العميل" type="tel" dir="ltr" className="text-right" value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} />
        <TextArea label="موقع العميل" value={customerLocation} onChange={(e) => setCustomerLocation(e.target.value)} />
        <Button type="submit" fullWidth loading={loading}>
          حفظ
        </Button>
      </form>
    </Modal>
  );
}

function EditRecurringModal({
  recurring,
  onClose,
}: {
  recurring: RecurringSchedule;
  onClose: () => void;
}) {
  const [scope, setScope] = useState<RecurringEditScope>("entire");
  const [effectiveDate, setEffectiveDate] = useState(nextIsoForDow(recurring.dayOfWeek));
  const [areaName, setAreaName] = useState(recurring.areaName);
  const [hours, setHours] = useState(String(recurring.hours));
  const [amount, setAmount] = useState(String(recurring.amount));
  const [customerPhone, setCustomerPhone] = useState(recurring.customerPhone);
  const [customerLocation, setCustomerLocation] = useState(recurring.customerLocation);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmedArea = areaName.trim();
    const hoursNum = Number(hours);
    const amountNum = Number(amount);
    if (!trimmedArea) return setError("أدخل اسم المنطقة");
    if (!hoursNum || hoursNum <= 0) return setError("أدخل عدد ساعات صحيح");
    if (Number.isNaN(amountNum) || amountNum < 0) return setError("أدخل مبلغاً صحيحاً");
    if (scope !== "entire" && dayOfWeek(effectiveDate) !== recurring.dayOfWeek) {
      return setError("التاريخ المختار لا يوافق يوم هذا الجدول");
    }

    setLoading(true);
    setError("");
    try {
      await editRecurringOccurrence({
        recurring,
        date: effectiveDate,
        scope,
        fields: {
          areaId: trimmedArea,
          areaName: trimmedArea,
          hours: hoursNum,
          amount: amountNum,
          customerPhone,
          customerLocation,
        },
      });
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "تعذر حفظ التعديل");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={`تعديل — ${recurring.workerName}`}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <ErrorBanner message={error} />
        <div className="space-y-2 rounded-xl border border-slate-200 p-3">
          {[
            { value: "single" as const, label: "هذا الموعد فقط" },
            { value: "forward" as const, label: "من هذا التاريخ فصاعدًا" },
            { value: "entire" as const, label: "الجدول المتكرر كاملًا" },
          ].map((opt) => (
            <label key={opt.value} className="flex items-center gap-2 py-1">
              <input
                type="radio"
                checked={scope === opt.value}
                onChange={() => setScope(opt.value)}
                className="h-4 w-4 accent-emerald-600"
              />
              <span className="text-sm text-slate-800">{opt.label}</span>
            </label>
          ))}
        </div>
        {scope !== "entire" && (
          <TextInput label="التاريخ" type="date" required value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} />
        )}
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
        <TextInput label="هاتف العميل" type="tel" dir="ltr" className="text-right" value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} />
        <TextArea label="موقع العميل" value={customerLocation} onChange={(e) => setCustomerLocation(e.target.value)} />
        <Button type="submit" fullWidth loading={loading}>
          حفظ
        </Button>
      </form>
    </Modal>
  );
}

function CancelRecurringModal({
  recurring,
  onClose,
}: {
  recurring: RecurringSchedule;
  onClose: () => void;
}) {
  const [scope, setScope] = useState<RecurringCancelScope>("single");
  const [effectiveDate, setEffectiveDate] = useState(nextIsoForDow(recurring.dayOfWeek));
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleConfirm() {
    if (dayOfWeek(effectiveDate) !== recurring.dayOfWeek) {
      setError("التاريخ المختار لا يوافق يوم هذا الجدول");
      return;
    }
    setLoading(true);
    setError("");
    try {
      await cancelRecurringOccurrence({
        recurring,
        date: effectiveDate,
        scope,
        reason: reason || null,
      });
      setSuccess("تم الإلغاء بنجاح");
      setTimeout(onClose, 800);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "تعذر تنفيذ الإلغاء");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={`إلغاء — ${recurring.workerName}`}>
      <div className="space-y-4">
        <ErrorBanner message={error} />
        <SuccessBanner message={success} />
        <div className="space-y-2 rounded-xl border border-slate-200 p-3">
          {[
            { value: "single" as const, label: "إلغاء هذا التاريخ فقط" },
            { value: "forward" as const, label: "إلغاء من هذا التاريخ فصاعدًا" },
          ].map((opt) => (
            <label key={opt.value} className="flex items-center gap-2 py-1">
              <input
                type="radio"
                checked={scope === opt.value}
                onChange={() => setScope(opt.value)}
                className="h-4 w-4 accent-emerald-600"
              />
              <span className="text-sm text-slate-800">{opt.label}</span>
            </label>
          ))}
        </div>
        <TextInput label="التاريخ" type="date" required value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} />
        <TextArea label="سبب الإلغاء (اختياري)" value={reason} onChange={(e) => setReason(e.target.value)} />
        <Button variant="danger" fullWidth loading={loading} onClick={handleConfirm}>
          تأكيد الإلغاء
        </Button>
      </div>
    </Modal>
  );
}
