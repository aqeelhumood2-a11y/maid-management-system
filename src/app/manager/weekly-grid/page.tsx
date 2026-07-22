"use client";

import { useMemo, useState } from "react";
import { ScheduleTable } from "@/components/schedule/ScheduleTable";
import { QuickBookingModal } from "@/components/schedule/QuickBookingModal";
import { BookingDetailsModal } from "@/components/schedule/BookingDetailsModal";
import { SelectInput, TextInput } from "@/components/ui/Field";
import { EmptyState, Spinner } from "@/components/ui/Feedback";
import { useWorkers } from "@/hooks/useWorkers";
import { useBookingsForDates } from "@/hooks/useBookingsForDates";
import { useRecurringSchedules, useRecurringExceptions } from "@/hooks/useRecurring";
import { formatDateAr, todayBahrain, weekDates, weekStart } from "@/lib/date";
import type { CellResolution, Shift, Worker } from "@/lib/types";

/**
 * The Weekly Booking Grid: pick a worker and any date, and the whole Sat–Fri
 * week containing that date loads as one screen — no need to create each
 * day's booking separately. Every cell reuses the exact same booking form as
 * everywhere else in the app (QuickBookingModal / BookingDetailsModal via
 * ScheduleTable), so it supports everything a normal booking does: existing
 * booking options, existing recurring-booking options (single/from this
 * date/entire schedule), and payment (manager only, already true here since
 * this whole page is manager-only). Each cell saves immediately on its own
 * form submit, exactly like every other booking action in this app — see
 * the module doc in the README for why this page doesn't stage a separate
 * "save the whole week" batch on top of that.
 */
export default function WeeklyBookingGridPage() {
  const today = todayBahrain();
  const { workers, loading: workersLoading } = useWorkers();
  const activeWorkers = workers.filter((w) => w.active);

  const [workerId, setWorkerId] = useState("");
  const [anchorDate, setAnchorDate] = useState(today);

  const dates = useMemo(() => weekDates(weekStart(anchorDate || today)), [anchorDate, today]);
  const selectedWorker = workers.find((w) => w.id === workerId) ?? null;

  const { bookings, loading: bookingsLoading } = useBookingsForDates(dates);
  const { schedules } = useRecurringSchedules();
  const { exceptions } = useRecurringExceptions();

  const [selection, setSelection] = useState<{
    worker: Worker;
    date: string;
    shift: Shift;
    resolution: CellResolution;
  } | null>(null);

  const loading = workersLoading || bookingsLoading;

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold text-slate-900">شبكة الحجز الأسبوعية</h1>
        <p className="text-sm text-slate-500">
          اختر عاملة وأي تاريخ ضمن الأسبوع المطلوب — يُحمَّل الأسبوع كاملاً (السبت—الجمعة) تلقائياً.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 sm:grid-cols-2">
        <SelectInput label="العاملة" required value={workerId} onChange={(e) => setWorkerId(e.target.value)}>
          <option value="">اختر العاملة</option>
          {activeWorkers.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </SelectInput>
        <TextInput
          label="أي تاريخ ضمن الأسبوع"
          type="date"
          required
          value={anchorDate}
          onChange={(e) => setAnchorDate(e.target.value)}
        />
      </div>

      {!selectedWorker ? (
        <EmptyState message="اختر عاملة لعرض شبكة حجزها الأسبوعية" />
      ) : (
        <>
          <p className="text-sm text-slate-500">
            {formatDateAr(dates[0])} — {formatDateAr(dates[6])}
          </p>
          {loading ? (
            <Spinner label="جارٍ تحميل الأسبوع..." />
          ) : (
            <ScheduleTable
              workers={[selectedWorker]}
              dates={dates}
              bookings={bookings}
              recurringSchedules={schedules}
              exceptions={exceptions}
              onCellClick={(worker, date, shift, resolution) => setSelection({ worker, date, shift, resolution })}
            />
          )}
        </>
      )}

      {selection && selection.resolution.status === "available" && (
        <QuickBookingModal
          open
          onClose={() => setSelection(null)}
          worker={selection.worker}
          date={selection.date}
          shift={selection.shift}
          source="weekly"
          allowRecurrence
          onSuccess={() => {}}
        />
      )}

      {selection && selection.resolution.status === "booked" && (
        <BookingDetailsModal
          open
          onClose={() => setSelection(null)}
          worker={selection.worker}
          workers={workers}
          date={selection.date}
          shift={selection.shift}
          resolution={selection.resolution}
          recurringSchedules={schedules}
          onSuccess={() => {}}
        />
      )}
    </div>
  );
}
