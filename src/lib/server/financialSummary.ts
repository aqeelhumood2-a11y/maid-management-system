import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { todayBahrain, weekStart } from "../date";
import { ServiceError, type Actor } from "./bookingService";
import type { ActivityActionType, Booking } from "../types";

/**
 * Manager Financial Settlement module. Everything here is a read-only
 * computation over existing `bookings` documents — there is no new
 * persisted "payout" entity, no new booking field, and no change to how a
 * booking is created, edited, paid or cancelled. This keeps requirement #8
 * (existing paid bookings are included automatically) and requirement #10
 * (preserve all existing booking/payment/recurring/schedule behavior) true
 * by construction: nothing here is ever written back to a `bookings` doc.
 */

function requireManager(actor: Actor) {
  if (actor.role !== "manager") {
    throw new ServiceError("هذا الإجراء متاح للمدير فقط", "FORBIDDEN", 403);
  }
}

/**
 * "Completed" has no dedicated booking status in this system (bookings are
 * only ever `active` or `cancelled`) — a completed booking is simply an
 * active one whose scheduled date has already occurred, i.e. `date <=
 * today` in Asia/Bahrain. This is a pure read-time interpretation, not a
 * new stored field, so it applies retroactively to every booking that
 * already exists with zero migration.
 */
function isCompleted(booking: Booking, today: string): boolean {
  return booking.status === "active" && booking.date <= today;
}

/**
 * Worker payout formula (per worker, per calendar day, counting only
 * completed AND paid bookings that day):
 *   0 bookings -> 0 BHD
 *   1 booking  -> 3 BHD
 *   2 bookings -> 7 BHD total (not 3+3 — the first pair is priced as 7)
 *   n>2        -> 7 BHD + 3 BHD for every booking past the second
 * e.g. 3 -> 10, 4 -> 13, 5 -> 16.
 */
export function computeDailyPayout(completedPaidCount: number): number {
  if (completedPaidCount <= 0) return 0;
  if (completedPaidCount === 1) return 3;
  return 7 + (completedPaidCount - 2) * 3;
}

export interface WorkerDailyEarning {
  date: string;
  completedBookings: number;
  paidBookings: number;
  earnings: number;
}

export interface WorkerPeriodEarning {
  period: string; // weekStart date (yyyy-MM-dd) or month (yyyy-MM)
  completedBookings: number;
  paidBookings: number;
  earnings: number;
}

export interface WorkerFinancialSummary {
  workerId: string;
  workerName: string;
  totalCompletedBookings: number;
  totalPaidBookings: number;
  totalEarnings: number;
  daily: WorkerDailyEarning[];
  weekly: WorkerPeriodEarning[];
  monthly: WorkerPeriodEarning[];
}

export interface FinancialSummary {
  rangeStart: string;
  rangeEnd: string;
  workers: WorkerFinancialSummary[];
  workersTotal: number;
  overallTotal: number;
  managerNet: number;
}

function aggregatePeriods(daily: WorkerDailyEarning[], periodOf: (date: string) => string): WorkerPeriodEarning[] {
  const byPeriod = new Map<string, WorkerPeriodEarning>();
  for (const day of daily) {
    const period = periodOf(day.date);
    const existing = byPeriod.get(period);
    if (existing) {
      existing.completedBookings += day.completedBookings;
      existing.paidBookings += day.paidBookings;
      existing.earnings += day.earnings;
    } else {
      byPeriod.set(period, {
        period,
        completedBookings: day.completedBookings,
        paidBookings: day.paidBookings,
        earnings: day.earnings,
      });
    }
  }
  return Array.from(byPeriod.values()).sort((a, b) => a.period.localeCompare(b.period));
}

/**
 * Pure computation over an already-fetched, already-filtered set of active
 * bookings within [rangeStart, rangeEnd] — kept separate from the Firestore
 * query itself so the payout math is unit-testable without an emulator.
 */
export function computeFinancialSummary(
  bookings: Booking[],
  rangeStart: string,
  rangeEnd: string,
  today: string = todayBahrain()
): FinancialSummary {
  const byWorkerDate = new Map<string, Map<string, Booking[]>>();
  const workerNames = new Map<string, string>();

  for (const booking of bookings) {
    if (!isCompleted(booking, today)) continue; // future-dated or cancelled: not "completed" yet
    workerNames.set(booking.workerId, booking.workerName);
    let dateMap = byWorkerDate.get(booking.workerId);
    if (!dateMap) {
      dateMap = new Map();
      byWorkerDate.set(booking.workerId, dateMap);
    }
    const onDate = dateMap.get(booking.date);
    if (onDate) onDate.push(booking);
    else dateMap.set(booking.date, [booking]);
  }

  const workers: WorkerFinancialSummary[] = [];
  let workersTotal = 0;
  let overallTotal = 0;

  for (const [workerId, dateMap] of byWorkerDate) {
    const daily: WorkerDailyEarning[] = [];
    let totalCompleted = 0;
    let totalPaid = 0;
    let totalEarnings = 0;

    for (const date of Array.from(dateMap.keys()).sort()) {
      const bookingsOnDate = dateMap.get(date)!;
      const paidBookingsOnDate = bookingsOnDate.filter((b) => b.paid);
      const earnings = computeDailyPayout(paidBookingsOnDate.length);

      totalCompleted += bookingsOnDate.length;
      totalPaid += paidBookingsOnDate.length;
      totalEarnings += earnings;
      for (const b of paidBookingsOnDate) {
        overallTotal += Number(b.paidAmount ?? b.amount) || 0;
      }

      daily.push({
        date,
        completedBookings: bookingsOnDate.length,
        paidBookings: paidBookingsOnDate.length,
        earnings,
      });
    }

    workersTotal += totalEarnings;
    workers.push({
      workerId,
      workerName: workerNames.get(workerId) ?? "",
      totalCompletedBookings: totalCompleted,
      totalPaidBookings: totalPaid,
      totalEarnings,
      daily,
      weekly: aggregatePeriods(daily, (date) => weekStart(date)),
      monthly: aggregatePeriods(daily, (date) => date.slice(0, 7)),
    });
  }

  workers.sort((a, b) => a.workerName.localeCompare(b.workerName, "ar"));

  return {
    rangeStart,
    rangeEnd,
    workers,
    workersTotal,
    overallTotal,
    managerNet: overallTotal - workersTotal,
  };
}

/**
 * Manager-only entry point: fetches every active booking whose date falls
 * in [rangeStart, rangeEnd] (the same `status == active` + date-range index
 * already used by GET /api/bookings), runs the pure computation above, and
 * records the calculation in the activity log (requirement #9) — every
 * settlement a manager generates is auditable, even though nothing about a
 * booking itself is ever mutated by it.
 */
export async function getFinancialSummaryServer(
  db: Firestore,
  rangeStart: string,
  rangeEnd: string,
  actor: Actor
): Promise<FinancialSummary> {
  requireManager(actor);

  const snap = await db
    .collection("bookings")
    .where("status", "==", "active")
    .where("date", ">=", rangeStart)
    .where("date", "<=", rangeEnd)
    .orderBy("date", "asc")
    .get();

  const bookings = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Booking);
  const summary = computeFinancialSummary(bookings, rangeStart, rangeEnd);

  await db.collection("activityLogs").add({
    type: "settlement_calculated" satisfies ActivityActionType,
    entityType: "financialSummary",
    entityId: `${rangeStart}_${rangeEnd}`,
    actingUid: actor.uid,
    actingEmail: actor.email,
    actingName: actor.name,
    before: null,
    after: {
      rangeStart,
      rangeEnd,
      workerCount: summary.workers.length,
      workersTotal: summary.workersTotal,
      overallTotal: summary.overallTotal,
      managerNet: summary.managerNet,
    },
    createdAt: FieldValue.serverTimestamp(),
  });

  return summary;
}
