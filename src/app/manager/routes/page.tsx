"use client";

import { useMemo, useState } from "react";
import { BookingDetailsModal } from "@/components/schedule/BookingDetailsModal";
import { Button } from "@/components/ui/Button";
import { SelectInput, TextInput } from "@/components/ui/Field";
import { EmptyState, Spinner } from "@/components/ui/Feedback";
import { useWorkers } from "@/hooks/useWorkers";
import { useBookingsForDates } from "@/hooks/useBookingsForDates";
import { useRecurringExceptions, useRecurringSchedules } from "@/hooks/useRecurring";
import { resolveCell } from "@/lib/availability";
import { formatDateAr, todayBahrain, weekdayLabelAr } from "@/lib/date";
import type { CellResolution, Shift, Worker } from "@/lib/types";

const SHIFT_LABEL: Record<Shift, string> = { morning: "صباحي", afternoon: "مسائي" };

/** Opens the location in Google Maps — customerLocation is a free-typed description, not a URL. */
function mapsLinkFor(location: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location)}`;
}

interface RouteRow {
  worker: Worker;
  resolution: CellResolution;
  areaName: string;
  customerPhone: string;
  customerLocation: string;
}

/**
 * The Daily Route — morning and evening are two entirely independent
 * routes, selected here by the Shift dropdown. Everything on screen
 * (bookings, edit action) is scoped to `date` + `shift`; switching shift
 * re-resolves the grid from scratch against that shift alone, so editing
 * a morning booking can never touch the evening route for the same day,
 * and vice versa.
 */
export default function RoutesPage() {
  const today = todayBahrain();
  const [date, setDate] = useState(today);
  const [shift, setShift] = useState<Shift>("morning");
  const [editing, setEditing] = useState<RouteRow | null>(null);

  const { workers, loading: workersLoading } = useWorkers();
  const { bookings, loading: bookingsLoading } = useBookingsForDates(date ? [date] : []);
  const { schedules } = useRecurringSchedules();
  const { exceptions } = useRecurringExceptions();

  const rows = useMemo<RouteRow[]>(() => {
    return workers
      .filter((w) => w.active)
      .map((worker): RouteRow | null => {
        const resolution = resolveCell(worker, date, shift, bookings, schedules, exceptions);
        if (resolution.status !== "booked") return null;
        if (resolution.booking) {
          const b = resolution.booking;
          return {
            worker,
            resolution,
            areaName: b.areaName,
            customerPhone: b.customerPhone,
            customerLocation: b.customerLocation,
          };
        }
        const r = resolution.virtualOccurrence!.recurring;
        return {
          worker,
          resolution,
          areaName: r.areaName,
          customerPhone: r.customerPhone,
          customerLocation: r.customerLocation,
        };
      })
      .filter((r): r is RouteRow => r !== null);
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
            {rows.map((r) => (
              <li key={r.worker.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div>
                  <p className="font-medium text-slate-900">{r.worker.name}</p>
                  <p className="text-sm text-slate-500">{r.areaName}</p>
                  {r.customerLocation && (
                    <a
                      href={mapsLinkFor(r.customerLocation)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-sky-600 underline hover:text-sky-800"
                    >
                      {r.customerLocation}
                    </a>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {r.customerPhone && (
                    <a
                      href={`tel:${r.customerPhone}`}
                      dir="ltr"
                      className="rounded-lg bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-100"
                    >
                      📞 {r.customerPhone}
                    </a>
                  )}
                  <Button size="sm" variant="secondary" onClick={() => setEditing(r)}>
                    تعديل
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {editing && (
        <BookingDetailsModal
          open
          onClose={() => setEditing(null)}
          worker={editing.worker}
          workers={workers}
          date={date}
          shift={shift}
          resolution={editing.resolution}
          recurringSchedules={schedules}
          onSuccess={() => {}}
        />
      )}
    </div>
  );
}
