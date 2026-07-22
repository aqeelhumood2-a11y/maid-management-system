"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { TextInput } from "@/components/ui/Field";
import { Badge, EmptyState, ErrorBanner, Spinner } from "@/components/ui/Feedback";
import { useManagerSession } from "@/context/ManagerSessionContext";
import { useWorkers } from "@/hooks/useWorkers";
import { useBookingsForDates } from "@/hooks/useBookingsForDates";
import { useRecurringExceptions, useRecurringSchedules } from "@/hooks/useRecurring";
import { resolveCell } from "@/lib/availability";
import { ApiError, updateBookingRouteStatus, type RouteStatusAction } from "@/lib/booking";
import { setRecurringOccurrenceRouteStatus } from "@/lib/recurring";
import { formatTimestampAr, todayBahrain } from "@/lib/date";
import type { CellResolution, RecurringSchedule, Shift, Worker } from "@/lib/types";

const SHIFT_LABEL: Record<Shift, string> = { morning: "صباحي", afternoon: "مسائي" };

interface RouteRow {
  worker: Worker;
  shift: Shift;
  areaName: string;
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
 * Requirement #5 — shows exactly: worker, area, phone, location, duration,
 * drop-off time, planned pickup, actual pickup, status, and the two action
 * buttons. Nothing about payment or pricing appears here at all (and
 * couldn't: GET /api/bookings already strips those fields for a non-manager
 * session before they ever reach the browser).
 */
export function RouteSchedule() {
  const { isManager } = useManagerSession();
  const today = todayBahrain();
  const [date, setDate] = useState(today);

  const { workers, loading: workersLoading } = useWorkers();
  const { bookings, loading: bookingsLoading } = useBookingsForDates(date ? [date] : []);
  const { schedules } = useRecurringSchedules();
  const { exceptions } = useRecurringExceptions();

  const [error, setError] = useState("");
  const [pendingKey, setPendingKey] = useState<string | null>(null);

  const rows = useMemo<RouteRow[]>(() => {
    const shifts: Shift[] = ["morning", "afternoon"];
    return workers
      .filter((w) => w.active)
      .flatMap((worker) =>
        shifts.map((shift): RouteRow | null => {
          const resolution: CellResolution = resolveCell(worker, date, shift, bookings, schedules, exceptions);
          if (resolution.status !== "booked") return null;
          const booking = resolution.booking;
          const recurring = resolution.virtualOccurrence?.recurring ?? null;
          return {
            worker,
            shift,
            areaName: booking?.areaName ?? recurring?.areaName ?? "",
            customerPhone: booking?.customerPhone ?? recurring?.customerPhone ?? "",
            customerLocation: booking?.customerLocation ?? recurring?.customerLocation ?? "",
            hours: booking?.hours ?? recurring?.hours ?? 0,
            dropOffAt: toDate(booking?.dropOffAt ?? null),
            pickupAt: toDate(booking?.pickupAt ?? null),
            bookingId: booking?.id ?? null,
            recurring: booking ? null : recurring,
          };
        })
      )
      .filter((r): r is RouteRow => r !== null);
  }, [workers, date, bookings, schedules, exceptions]);

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

      <div className="max-w-xs rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <TextInput label="التاريخ" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </div>

      <ErrorBanner message={error} />

      {loading ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <EmptyState message="لا يوجد حجوزات نشطة في هذا التاريخ" />
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
                      <p className="font-medium text-slate-900">
                        {row.worker.name} · {SHIFT_LABEL[row.shift]}
                      </p>
                      <p className="text-sm text-slate-500">{row.areaName}</p>
                      {row.customerLocation && <p className="text-xs text-slate-400">{row.customerLocation}</p>}
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
                    {isManager && (
                      <>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={!row.dropOffAt}
                          loading={pendingKey === `${row.worker.id}_${row.shift}_reset_drop_off`}
                          onClick={() => handleAction(row, "reset_drop_off")}
                        >
                          إعادة تعيين التنزيل
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={!row.pickupAt}
                          loading={pendingKey === `${row.worker.id}_${row.shift}_reset_pickup`}
                          onClick={() => handleAction(row, "reset_pickup")}
                        >
                          إعادة تعيين الاستلام
                        </Button>
                      </>
                    )}
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
