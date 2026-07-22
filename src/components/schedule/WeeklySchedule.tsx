"use client";

import { useMemo, useState } from "react";
import { ScheduleTable } from "@/components/schedule/ScheduleTable";
import { QuickBookingModal } from "@/components/schedule/QuickBookingModal";
import { BookingDetailsModal } from "@/components/schedule/BookingDetailsModal";
import { Badge, Spinner } from "@/components/ui/Feedback";
import { Button } from "@/components/ui/Button";
import { useWorkers } from "@/hooks/useWorkers";
import { useBookingsForDates } from "@/hooks/useBookingsForDates";
import { useRecurringSchedules, useRecurringExceptions } from "@/hooks/useRecurring";
import { addDaysToDateStr, formatDateAr, todayBahrain, weekDates, weekStart } from "@/lib/date";
import type { CellResolution, Shift, Worker } from "@/lib/types";

export function WeeklySchedule() {
  const today = todayBahrain();
  const currentWeekStart = weekStart(today);
  const [selectedWeekStart, setSelectedWeekStart] = useState(currentWeekStart);

  const dates = useMemo(() => weekDates(selectedWeekStart), [selectedWeekStart]);

  const { workers, loading: workersLoading } = useWorkers();
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
  const isCurrentWeek = selectedWeekStart === currentWeekStart;

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold text-slate-900">الجدول الأسبوعي</h1>
        <p className="text-sm text-slate-500">
          {formatDateAr(dates[0])} — {formatDateAr(dates[6])}
        </p>
      </div>

      <div className="flex items-center gap-2">
        <Button variant="secondary" size="sm" onClick={() => setSelectedWeekStart(addDaysToDateStr(selectedWeekStart, -7))}>
          الأسبوع السابق ←
        </Button>
        <Button
          variant={isCurrentWeek ? "primary" : "secondary"}
          size="sm"
          onClick={() => setSelectedWeekStart(currentWeekStart)}
        >
          الأسبوع الحالي
        </Button>
        <Button variant="secondary" size="sm" onClick={() => setSelectedWeekStart(addDaysToDateStr(selectedWeekStart, 7))}>
          → الأسبوع القادم
        </Button>
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
          dates={dates}
          bookings={bookings}
          recurringSchedules={schedules}
          exceptions={exceptions}
          onCellClick={(worker, date, shift, resolution) => setSelection({ worker, date, shift, resolution })}
        />
      )}

      {selection && selection.resolution.status === "available" && (
        <QuickBookingModal
          open
          onClose={() => setSelection(null)}
          worker={selection.worker}
          date={selection.date}
          shift={selection.shift}
          source="weekly"
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
