import { dayOfWeek, isFriday } from "./date";
import type {
  Booking,
  CellResolution,
  RecurringException,
  RecurringSchedule,
  Shift,
  Worker,
} from "./types";

export function slotId(workerId: string, date: string, shift: Shift): string {
  return `${workerId}_${date}_${shift}`;
}

/**
 * Finds the recurring schedule (if any) that governs a worker/date/shift,
 * honoring single-occurrence exceptions, without pre-generating any documents.
 */
export function findRecurringOccurrence(
  workerId: string,
  date: string,
  shift: Shift,
  recurringSchedules: RecurringSchedule[],
  exceptions: RecurringException[]
): { recurring: RecurringSchedule; exception: RecurringException | null } | null {
  const dow = dayOfWeek(date);
  const candidates = recurringSchedules.filter(
    (r) =>
      r.workerId === workerId &&
      r.shift === shift &&
      r.dayOfWeek === dow &&
      r.status === "active" &&
      r.startDate <= date &&
      (!r.endDate || r.endDate >= date)
  );

  for (const recurring of candidates) {
    const exception = exceptions.find(
      (e) => e.recurringId === recurring.id && e.date === date
    );
    if (exception?.type === "cancelled") continue;
    return { recurring, exception: exception ?? null };
  }
  return null;
}

/**
 * Resolves the status of a single worker/date/shift cell.
 * Priority: inactive worker > active concrete booking > Friday holiday > recurring occurrence > available.
 * An active concrete booking always wins over the Friday rule, which is how exceptional
 * manager Friday bookings show as booked while every other worker stays on holiday.
 */
export function resolveCell(
  worker: Worker,
  date: string,
  shift: Shift,
  bookings: Booking[],
  recurringSchedules: RecurringSchedule[],
  exceptions: RecurringException[]
): CellResolution {
  if (!worker.active) {
    return { status: "inactive", booking: null, virtualOccurrence: null };
  }

  const activeBooking = bookings.find(
    (b) =>
      b.workerId === worker.id &&
      b.date === date &&
      b.shift === shift &&
      b.status === "active"
  );
  if (activeBooking) {
    return { status: "booked", booking: activeBooking, virtualOccurrence: null };
  }

  if (isFriday(date)) {
    return { status: "friday_holiday", booking: null, virtualOccurrence: null };
  }

  const occurrence = findRecurringOccurrence(
    worker.id,
    date,
    shift,
    recurringSchedules,
    exceptions
  );
  if (occurrence) {
    return { status: "booked", booking: null, virtualOccurrence: occurrence };
  }

  return { status: "available", booking: null, virtualOccurrence: null };
}

/** A worker can be selected for a new booking when the slot isn't already occupied. */
export function isEligibleForBooking(status: CellResolution["status"]): boolean {
  return status === "available" || status === "friday_holiday";
}
