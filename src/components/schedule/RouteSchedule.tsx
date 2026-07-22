"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { TextInput } from "@/components/ui/Field";
import { Badge, EmptyState, ErrorBanner, Spinner } from "@/components/ui/Feedback";
import { useWorkers } from "@/hooks/useWorkers";
import { useBookingsForDates } from "@/hooks/useBookingsForDates";
import { useRecurringExceptions, useRecurringSchedules } from "@/hooks/useRecurring";
import { useRouteOrder } from "@/hooks/useRouteOrder";
import { resolveCell } from "@/lib/availability";
import { ApiError, updateBookingRouteStatus, type RouteStatusAction } from "@/lib/booking";
import { setRecurringOccurrenceRouteStatus } from "@/lib/recurring";
import { formatTimestampAr, todayBahrain } from "@/lib/date";
import { mapsLinkFor } from "@/lib/maps";
import { applyRouteOrder } from "@/lib/routeOrder";
import type { CellResolution, RecurringSchedule, Shift, Worker } from "@/lib/types";

const SHIFT_OPTIONS: { value: Shift; label: string }[] = [
  { value: "morning", label: "صباحي" },
  { value: "afternoon", label: "مسائي" },
];

interface RouteRow {
  worker: Worker;
  shift: Shift;
  areaName: string;
  customerName: string;
  customerPhone: string;
  customerLocation: string;
  hours: number;
  dropOffAt: Date | null;
  pickupAt: Date | null;
  bookingId: string | null;
  recurring: RecurringSchedule | null;
}

function toDate(ts: { _seconds: number } | null): Date | null {
  return ts ? new Date(ts._seconds * 1000) : null;
}

/**
 * The Employee Route Schedule — exactly one shift is visible at a time via
 * the صباحي/مسائي selector below; switching it swaps the entire list, it
 * never shows both shifts stacked together. This screen carries no
 * manager-only affordance at all (no reset/correction actions) — those live
 * exclusively in the Manager Dashboard's Daily Route page. Nothing about
 * payment or pricing appears here either (and couldn't: GET /api/bookings
 * already strips those fields for a non-manager session before they ever
 * reach the browser).
 */
export function RouteSchedule() {
  const today = todayBahrain();
  const [date, setDate] = useState(today);
  const [shift, setShift] = useState<Shift>("morning");

  const { workers, loading: workersLoading } = useWorkers();
  const { bookings, loading: bookingsLoading } = useBookingsForDates(date ? [date] : []);
  const { schedules } = useRecurringSchedules();
  const { exceptions } = useRecurringExceptions();
  const { workerIds: routeOrder } = useRouteOrder(date, shift);

  const [error, setError] = useState("");
  const [pendingKey, setPendingKey] = useState<string | null>(null);

  const rows = useMemo<RouteRow[]>(() => {
    const built = workers
      .filter((w) => w.active)
      .map((worker): RouteRow | null => {
        const resolution: CellResolution = resolveCell(worker, date, shift, bookings, schedules, exceptions);
        if (resolution.status !== "booked") return null;
        const booking = resolution.booking;
        const recurring = resolution.virtualOccurrence?.recurring ?? null;
        return {
          worker,
          shift,
          areaName: booking?.areaName ?? recurring?.areaName ?? "",
          customerName: booking?.customerName ?? recurring?.customerName ?? "",
          customerPhone: booking?.customerPhone ?? recurring?.customerPhone ?? "",
          customerLocation: booking?.customerLocation ?? recurring?.customerLocation ?? "",
          hours: booking?.hours ?? recurring?.hours ?? 0,
          dropOffAt: toDate(booking?.dropOffAt ?? null),
          pickupAt: toDate(booking?.pickupAt ?? null),
          bookingId: booking?.id ?? null,
          recurring: booking ? null : recurring,
        };
      })
      .filter((r): r is RouteRow => r !== null);

    return applyRouteOrder(built, routeOrder, (r) => r.worker.id);
  }, [workers, date, shift, bookings, schedules, exceptions, routeOrder]);

  const loading = workersLoading || bookingsLoading;

  async function handleAction(row: RouteRow, action: RouteStatusAction) {
    const key = `${row.worker.id}_${row.shift}_${action}`;
    setError("");
    setPendingKey(key);
    try {
      if (row.bookingId) {
        await updateBookingRouteStatus(row.bookingId, action);
      } else if (row.recurring) {
        await setRecurringOccurrenceRouteStatus({ recurring: row.recurring, date, action });
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "تعذر تحديث حالة خط السير");
    } finally {
      setPendingKey(null);
    }
  }

  return (
    <div className="flex flex-1 flex-col gap-4">
      <h1 className="text-xl font-bold text-slate-900">خط السير</h1>

      <div className="flex flex-col gap-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 sm:flex-row sm:items-end">
        <TextInput label="التاريخ" type="date" value={date} onChange={(e) => setDate(e.target.value)} />

        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-slate-700">الفترة</span>
          <div className="flex gap-2 rounded-xl bg-slate-100 p-1">
            {SHIFT_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                aria-pressed={shift === opt.value}
                onClick={() => setShift(opt.value)}
                className={`rounded-lg px-5 py-2 text-sm font-medium transition-colors ${
                  shift === opt.value ? "bg-emerald-600 text-white" : "text-slate-600 hover:bg-slate-200"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <ErrorBanner message={error} />

      {loading ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <EmptyState message="لا يوجد حجوزات نشطة في هذه الجولة" />
      ) : (
        <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
          <ul className="divide-y divide-slate-100">
            {rows.map((row) => {
              const status: { label: string; color: "green" | "yellow" | "gray" } = row.pickupAt
                ? { label: "تم الاستلام", color: "green" }
                : row.dropOffAt
                  ? { label: "تم التنزيل — بانتظار الاستلام", color: "yellow" }
                  : { label: "بانتظار التنزيل", color: "gray" };
              const plannedPickup =
                row.dropOffAt && row.hours
                  ? new Date(row.dropOffAt.getTime() + row.hours * 60 * 60 * 1000)
                  : null;

              return (
                <li key={`${row.worker.id}_${row.shift}`} className="flex flex-col gap-3 px-4 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-medium text-slate-900">{row.worker.name}</p>
                      <p className="text-sm text-slate-500">{row.areaName}</p>
                      {row.customerName && <p className="text-sm text-slate-700">{row.customerName}</p>}
                      {row.customerLocation && (
                        <a
                          href={mapsLinkFor(row.customerLocation)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-sky-600 underline hover:text-sky-800"
                        >
                          {row.customerLocation}
                        </a>
                      )}
                      <p className="text-xs text-slate-400">{row.hours} ساعة</p>
                    </div>
                    <Badge color={status.color}>{status.label}</Badge>
                  </div>

                  {row.customerPhone && (
                    <a
                      href={`tel:${row.customerPhone}`}
                      dir="ltr"
                      className="w-fit rounded-lg bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-100"
                    >
                      📞 {row.customerPhone}
                    </a>
                  )}

                  <dl className="grid grid-cols-3 gap-2 text-xs text-slate-500">
                    <div>
                      <dt>وقت التنزيل</dt>
                      <dd className="font-medium text-slate-800">
                        {row.dropOffAt ? formatTimestampAr(row.dropOffAt) : "—"}
                      </dd>
                    </div>
                    <div>
                      <dt>الاستلام المتوقع</dt>
                      <dd className="font-medium text-slate-800">
                        {plannedPickup ? formatTimestampAr(plannedPickup) : "—"}
                      </dd>
                    </div>
                    <div>
                      <dt>وقت الاستلام الفعلي</dt>
                      <dd className="font-medium text-slate-800">
                        {row.pickupAt ? formatTimestampAr(row.pickupAt) : "—"}
                      </dd>
                    </div>
                  </dl>

                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      disabled={!!row.dropOffAt}
                      loading={pendingKey === `${row.worker.id}_${row.shift}_drop_off`}
                      onClick={() => handleAction(row, "drop_off")}
                    >
                      تم التنزيل
                    </Button>
                    <Button
                      size="sm"
                      disabled={!row.dropOffAt || !!row.pickupAt}
                      loading={pendingKey === `${row.worker.id}_${row.shift}_pickup`}
                      onClick={() => handleAction(row, "pickup")}
                    >
                      تم الاستلام
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
