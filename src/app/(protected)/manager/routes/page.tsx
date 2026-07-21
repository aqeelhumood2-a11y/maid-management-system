"use client";

import { useMemo, useState } from "react";
import { SelectInput, TextInput } from "@/components/ui/Field";
import { EmptyState, Spinner } from "@/components/ui/Feedback";
import { useWorkers } from "@/hooks/useWorkers";
import { useBookingsForDates } from "@/hooks/useBookingsForDates";
import { useRecurringExceptions, useRecurringSchedules } from "@/hooks/useRecurring";
import { resolveCell } from "@/lib/availability";
import { formatDateAr, todayBahrain, weekdayLabelAr } from "@/lib/date";
import type { Shift } from "@/lib/types";

const SHIFT_LABEL: Record<Shift, string> = { morning: "صباحي", afternoon: "مسائي" };

export default function RoutesPage() {
  const today = todayBahrain();
  const [date, setDate] = useState(today);
  const [shift, setShift] = useState<Shift>("morning");

  const { workers, loading: workersLoading } = useWorkers();
  const { bookings, loading: bookingsLoading } = useBookingsForDates(date ? [date] : []);
  const { schedules } = useRecurringSchedules();
  const { exceptions } = useRecurringExceptions();

  const rows = useMemo(() => {
    return workers
      .filter((w) => w.active)
      .map((worker) => {
        const resolution = resolveCell(worker, date, shift, bookings, schedules, exceptions);
        if (resolution.status !== "booked") return null;
        if (resolution.booking) {
          const b = resolution.booking;
          return {
            workerName: worker.name,
            areaName: b.areaName,
            customerPhone: b.customerPhone,
            customerLocation: b.customerLocation,
          };
        }
        const r = resolution.virtualOccurrence!.recurring;
        return {
          workerName: worker.name,
          areaName: r.areaName,
          customerPhone: r.customerPhone,
          customerLocation: r.customerLocation,
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);
  }, [workers, date, shift, bookings, schedules, exceptions]);

  const loading = workersLoading || bookingsLoading;

  return (
    <div className="flex flex-1 flex-col gap-4">
      <h1 className="text-xl font-bold text-slate-900">خطوط السير</h1>

      <div className="grid grid-cols-2 gap-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <TextInput label="التاريخ" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <SelectInput label="الفترة" value={shift} onChange={(e) => setShift(e.target.value as Shift)}>
          <option value="morning">صباحي</option>
          <option value="afternoon">مسائي</option>
        </SelectInput>
      </div>

      {date && (
        <p className="text-sm text-slate-500">
          {weekdayLabelAr(date)} {formatDateAr(date)} · {SHIFT_LABEL[shift]}
        </p>
      )}

      {loading ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <EmptyState message="لا يوجد حجوزات نشطة في هذا الموعد" />
      ) : (
        <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
          <ul className="divide-y divide-slate-100">
            {rows.map((r, i) => (
              <li key={i} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div>
                  <p className="font-medium text-slate-900">{r.workerName}</p>
                  <p className="text-sm text-slate-500">{r.areaName}</p>
                  {r.customerLocation && <p className="text-xs text-slate-400">{r.customerLocation}</p>}
                </div>
                {r.customerPhone && (
                  <a
                    href={`tel:${r.customerPhone}`}
                    dir="ltr"
                    className="rounded-lg bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-100"
                  >
                    📞 {r.customerPhone}
                  </a>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
