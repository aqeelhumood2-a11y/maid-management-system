"use client";

import { useMemo, useState } from "react";
import { BookingDetailsModal } from "@/components/schedule/BookingDetailsModal";
import { QuickBookingModal } from "@/components/schedule/QuickBookingModal";
import { Button } from "@/components/ui/Button";
import { SelectInput, TextInput } from "@/components/ui/Field";
import { Badge, EmptyState, Spinner, ErrorBanner } from "@/components/ui/Feedback";
import { Modal } from "@/components/ui/Modal";
import { useWorkers } from "@/hooks/useWorkers";
import { useBookingsForDates } from "@/hooks/useBookingsForDates";
import { useRecurringExceptions, useRecurringSchedules } from "@/hooks/useRecurring";
import { useRouteOrder } from "@/hooks/useRouteOrder";
import { resolveCell } from "@/lib/availability";
import { ApiError, updateBookingRouteStatus, type RouteStatusAction } from "@/lib/booking";
import { formatDateAr, todayBahrain, weekdayLabelAr } from "@/lib/date";
import { mapsLinkFor } from "@/lib/maps";
import { setRecurringOccurrenceRouteStatus } from "@/lib/recurring";
import { applyRouteOrder, saveRouteOrder } from "@/lib/routeOrder";
import type { CellResolution, RecurringSchedule, Shift, Worker } from "@/lib/types";

const SHIFT_TABS: { value: Shift; label: string }[] = [
  { value: "morning", label: "الجولة الصباحية" },
  { value: "afternoon", label: "الجولة المسائية" },
];

interface RouteRow {
  worker: Worker;
  resolution: CellResolution;
  areaName: string;
  customerName: string;
  customerPhone: string;
  customerLocation: string;
  isRecurring: boolean;
  bookingId: string | null;
  recurring: RecurringSchedule | null;
  dropOffAt: Date | null;
  pickupAt: Date | null;
}

function toDate(ts: { _seconds: number } | null): Date | null {
  return ts ? new Date(ts._seconds * 1000) : null;
}

/**
 * The Daily Route — morning and evening are two entirely independent
 * routes, selected here by tabs (not a shared dropdown). Everything on
 * screen (bookings, order, create/edit/delete) is scoped to `date` +
 * `shift`; switching shift re-resolves the route from scratch, so editing
 * or reordering the morning route can never touch the evening route for
 * the same day, and vice versa.
 */
export default function RoutesPage() {
  const today = todayBahrain();
  const [date, setDate] = useState(today);
  const [shift, setShift] = useState<Shift>("morning");
  const [editing, setEditing] = useState<RouteRow | null>(null);
  const [deleting, setDeleting] = useState<RouteRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [actionError, setActionError] = useState("");
  const [actionPendingKey, setActionPendingKey] = useState<string | null>(null);

  const { workers, loading: workersLoading } = useWorkers();
  const { bookings, loading: bookingsLoading } = useBookingsForDates(date ? [date] : []);
  const { schedules } = useRecurringSchedules();
  const { exceptions } = useRecurringExceptions();
  const { workerIds: savedOrder } = useRouteOrder(date, shift);

  const baseRows = useMemo<RouteRow[]>(() => {
    return workers
      .filter((w) => w.active)
      .map((worker): RouteRow | null => {
        const resolution = resolveCell(worker, date, shift, bookings, schedules, exceptions);
        if (resolution.status !== "booked") return null;
        const isRecurring = resolution.virtualOccurrence !== null || resolution.booking?.recurringSeriesId != null;
        if (resolution.booking) {
          const b = resolution.booking;
          return {
            worker,
            resolution,
            areaName: b.areaName,
            customerName: b.customerName,
            customerPhone: b.customerPhone,
            customerLocation: b.customerLocation,
            isRecurring,
            bookingId: b.id,
            recurring: isRecurring ? (schedules.find((s) => s.id === b.recurringSeriesId) ?? null) : null,
            dropOffAt: toDate(b.dropOffAt),
            pickupAt: toDate(b.pickupAt),
          };
        }
        const r = resolution.virtualOccurrence!.recurring;
        return {
          worker,
          resolution,
          areaName: r.areaName,
          customerName: r.customerName,
          customerPhone: r.customerPhone,
          customerLocation: r.customerLocation,
          isRecurring,
          bookingId: null,
          recurring: r,
          dropOffAt: null,
          pickupAt: null,
        };
      })
      .filter((r): r is RouteRow => r !== null);
  }, [workers, date, shift, bookings, schedules, exceptions]);

  const orderedRows = useMemo(
    () => applyRouteOrder(baseRows, savedOrder, (r) => r.worker.id),
    [baseRows, savedOrder]
  );

  const [manualRows, setManualRows] = useState<RouteRow[] | null>(null);
  const [orderError, setOrderError] = useState("");
  const [orderSaving, setOrderSaving] = useState(false);

  // Reset any staged (unsaved) manual order the moment date or shift changes,
  // so a reorder started on one route can never leak into another.
  const routeKey = `${date}_${shift}`;
  const [lastRouteKey, setLastRouteKey] = useState(routeKey);
  if (routeKey !== lastRouteKey) {
    setLastRouteKey(routeKey);
    setManualRows(null);
    setOrderError("");
  }

  const rows = manualRows ?? orderedRows;

  function moveRow(index: number, direction: -1 | 1) {
    const target = index + direction;
    const base = manualRows ?? orderedRows;
    if (target < 0 || target >= base.length) return;
    const next = base.slice();
    [next[index], next[target]] = [next[target], next[index]];
    setManualRows(next);
  }

  async function handleSaveOrder() {
    if (!manualRows) return;
    setOrderSaving(true);
    setOrderError("");
    try {
      await saveRouteOrder(date, shift, manualRows.map((r) => r.worker.id));
      setManualRows(null);
    } catch (err) {
      setOrderError(err instanceof ApiError ? err.message : "تعذر حفظ الترتيب");
    } finally {
      setOrderSaving(false);
    }
  }

  async function handleRouteStatusReset(row: RouteRow, action: RouteStatusAction) {
    const key = `${row.worker.id}_${action}`;
    setActionError("");
    setActionPendingKey(key);
    try {
      if (row.bookingId) {
        await updateBookingRouteStatus(row.bookingId, action);
      } else if (row.recurring) {
        await setRecurringOccurrenceRouteStatus({ recurring: row.recurring, date, action });
      }
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "تعذر تحديث حالة خط السير");
    } finally {
      setActionPendingKey(null);
    }
  }

  const bookedWorkerIds = useMemo(() => new Set(baseRows.map((r) => r.worker.id)), [baseRows]);
  const eligibleWorkers = useMemo(() => {
    if (!date) return [];
    return workers
      .filter((w) => w.active && !bookedWorkerIds.has(w.id))
      .map((w) => ({ worker: w, resolution: resolveCell(w, date, shift, bookings, schedules, exceptions) }))
      .filter(({ resolution }) => resolution.status === "available" || resolution.status === "friday_holiday");
  }, [workers, date, shift, bookings, schedules, exceptions, bookedWorkerIds]);

  const loading = workersLoading || bookingsLoading;

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-slate-900">خطوط السير اليومية</h1>
        <Button size="sm" onClick={() => setCreating(true)}>
          + إضافة
        </Button>
      </div>

      <div className="flex gap-2 rounded-2xl bg-white p-1.5 shadow-sm ring-1 ring-slate-200">
        {SHIFT_TABS.map((tab) => (
          <button
            key={tab.value}
            type="button"
            onClick={() => setShift(tab.value)}
            className={`flex-1 rounded-xl px-4 py-2.5 text-sm font-medium transition-colors ${
              shift === tab.value ? "bg-emerald-600 text-white" : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <TextInput label="التاريخ" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </div>

      {date && (
        <p className="text-sm text-slate-500">
          {weekdayLabelAr(date)} {formatDateAr(date)}
        </p>
      )}

      <ErrorBanner message={orderError} />
      <ErrorBanner message={actionError} />

      {loading ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <EmptyState message="لا يوجد حجوزات نشطة في هذا الموعد" />
      ) : (
        <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
          <ul className="divide-y divide-slate-100">
            {rows.map((r, index) => {
              const status: { label: string; color: "green" | "yellow" | "gray" } = r.pickupAt
                ? { label: "تم الاستلام", color: "green" }
                : r.dropOffAt
                  ? { label: "تم التنزيل — بانتظار الاستلام", color: "yellow" }
                  : { label: "بانتظار التنزيل", color: "gray" };

              return (
                <li key={r.worker.id} className="flex flex-col gap-3 px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-start gap-2">
                      <div className="flex flex-col gap-1 pt-0.5">
                        <button
                          type="button"
                          disabled={index === 0}
                          onClick={() => moveRow(index, -1)}
                          aria-label="نقل للأعلى"
                          className="flex h-6 w-6 items-center justify-center rounded bg-slate-100 text-slate-600 hover:bg-slate-200 disabled:opacity-30"
                        >
                          ▲
                        </button>
                        <button
                          type="button"
                          disabled={index === rows.length - 1}
                          onClick={() => moveRow(index, 1)}
                          aria-label="نقل للأسفل"
                          className="flex h-6 w-6 items-center justify-center rounded bg-slate-100 text-slate-600 hover:bg-slate-200 disabled:opacity-30"
                        >
                          ▼
                        </button>
                      </div>
                      <div>
                        <p className="font-medium text-slate-900">{r.worker.name}</p>
                        <p className="text-sm text-slate-500">{r.areaName}</p>
                        {r.customerName && <p className="text-sm text-slate-700">{r.customerName}</p>}
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
                      <Button size="sm" variant="danger" onClick={() => setDeleting(r)}>
                        حذف
                      </Button>
                    </div>
                  </div>

                  {/* Route status correction — manager only, and only reachable here in the
                      Manager Dashboard; the Employee Route Schedule has no such control at all. */}
                  <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-2">
                    <Badge color={status.color}>{status.label}</Badge>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={!r.dropOffAt}
                      loading={actionPendingKey === `${r.worker.id}_reset_drop_off`}
                      onClick={() => handleRouteStatusReset(r, "reset_drop_off")}
                    >
                      إعادة تعيين التنزيل
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={!r.pickupAt}
                      loading={actionPendingKey === `${r.worker.id}_reset_pickup`}
                      onClick={() => handleRouteStatusReset(r, "reset_pickup")}
                    >
                      إعادة تعيين الاستلام
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {manualRows && (
        <div className="flex items-center gap-3">
          <Button onClick={handleSaveOrder} loading={orderSaving}>
            حفظ الترتيب
          </Button>
          <Button variant="secondary" onClick={() => setManualRows(null)} disabled={orderSaving}>
            تراجع
          </Button>
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

      {deleting && (
        <BookingDetailsModal
          open
          onClose={() => setDeleting(null)}
          worker={deleting.worker}
          workers={workers}
          date={date}
          shift={shift}
          resolution={deleting.resolution}
          recurringSchedules={schedules}
          initialView={deleting.isRecurring ? "cancelRecurringScope" : "cancelSingle"}
          onSuccess={() => {}}
        />
      )}

      {creating && (
        <CreateRouteEntryModal
          date={date}
          shift={shift}
          eligibleWorkers={eligibleWorkers.map((x) => x.worker)}
          onClose={() => setCreating(false)}
        />
      )}
    </div>
  );
}

function CreateRouteEntryModal({
  date,
  shift,
  eligibleWorkers,
  onClose,
}: {
  date: string;
  shift: Shift;
  eligibleWorkers: Worker[];
  onClose: () => void;
}) {
  const [workerId, setWorkerId] = useState("");
  const worker = eligibleWorkers.find((w) => w.id === workerId) ?? null;

  if (worker) {
    return (
      <QuickBookingModal
        open
        onClose={onClose}
        worker={worker}
        date={date}
        shift={shift}
        source="manager_future"
        onSuccess={onClose}
      />
    );
  }

  return (
    <Modal open onClose={onClose} title="إضافة إلى خط السير">
      <div className="space-y-4">
        <SelectInput label="العاملة" value={workerId} onChange={(e) => setWorkerId(e.target.value)}>
          <option value="">
            {eligibleWorkers.length === 0 ? "لا توجد عاملات متاحة لهذا الموعد" : "اختر العاملة"}
          </option>
          {eligibleWorkers.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </SelectInput>
      </div>
    </Modal>
  );
}
