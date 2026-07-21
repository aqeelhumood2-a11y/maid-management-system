"use client";

import { useState } from "react";
import { ScheduleTable } from "@/components/schedule/ScheduleTable";
import { QuickBookingModal } from "@/components/schedule/QuickBookingModal";
import { BookingDetailsModal } from "@/components/schedule/BookingDetailsModal";
import { Badge, Spinner } from "@/components/ui/Feedback";
import { useWorkers } from "@/hooks/useWorkers";
import { useBookingsForDates } from "@/hooks/useBookingsForDates";
import { useRecurringSchedules, useRecurringExceptions } from "@/hooks/useRecurring";
import { formatDateAr, todayBahrain, weekdayLabelAr } from "@/lib/date";
import type { CellResolution, Shift, Worker } from "@/lib/types";

export default function TodayPage() {
  const today = todayBahrain();
  const { workers, loading: workersLoading } = useWorkers();
  const { bookings, loading: bookingsLoading } = useBookingsForDates([today]);
  const { schedules } = useRecurringSchedules();
  const { exceptions } = useRecurringExceptions();

  const [selection, setSelection] = useState<{
    worker: Worker;
    shift: Shift;
    resolution: CellResolution;
  } | null>(null);

  const loading = workersLoading || bookingsLoading;

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold text-slate-900">جدول اليوم</h1>
        <p className="text-sm text-slate-500">
          {weekdayLabelAr(today)} {formatDateAr(today)}
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Badge color="green">متاحة</Badge>
        <Badge color="red">محجوزة</Badge>
        <Badge color="yellow">إجازة</Badge>
        <Badge color="gray">غير نشطة</Badge>
      </div>

      {loading ? (
        <Spinner label="جارٍ تحميل الجدول..." />
      ) : workers.length === 0 ? (
        <p className="rounded-xl bg-white p-6 text-center text-sm text-slate-500 ring-1 ring-slate-200">
          لا يوجد عاملات مسجلات بعد
        </p>
      ) : (
        <ScheduleTable
          workers={workers}
          dates={[today]}
          bookings={bookings}
          recurringSchedules={schedules}
          exceptions={exceptions}
          onCellClick={(worker, _date, shift, resolution) => setSelection({ worker, shift, resolution })}
        />
      )}

      {selection && selection.resolution.status === "available" && (
        <QuickBookingModal
          open
          onClose={() => setSelection(null)}
          worker={selection.worker}
          date={today}
          shift={selection.shift}
          source="today"
          onSuccess={() => {}}
        />
      )}

      {selection && selection.resolution.status === "booked" && (
        <BookingDetailsModal
          open
          onClose={() => setSelection(null)}
          worker={selection.worker}
          date={today}
          shift={selection.shift}
          resolution={selection.resolution}
          recurringSchedules={schedules}
          onSuccess={() => {}}
        />
      )}
    </div>
  );
}
