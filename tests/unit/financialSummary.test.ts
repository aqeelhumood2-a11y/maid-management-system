import { describe, expect, it } from "vitest";
import { computeDailyPayout, computeFinancialSummary } from "@/lib/server/financialSummary";
import type { Booking } from "@/lib/types";

function makeBooking(overrides: Partial<Booking> = {}): Booking {
  return {
    id: "b1",
    date: "2026-07-20",
    shift: "morning",
    workerId: "w1",
    workerName: "سارة",
    areaId: "a1",
    areaName: "المنامة",
    hours: 4,
    amount: 10,
    paymentMethod: "cash",
    paid: true,
    paidAmount: 10,
    paymentDate: null,
    paymentBy: "manager",
    dropOffAt: null,
    pickupAt: null,
    customerPhone: "",
    customerLocation: "",
    source: "today",
    recurringSeriesId: null,
    status: "active",
    cancelledAt: null,
    cancelledBy: null,
    cancelledReason: null,
    cancelScope: null,
    createdBy: "u1",
    createdAt: null,
    updatedBy: "u1",
    updatedAt: null,
    ...overrides,
  };
}

describe("computeDailyPayout — worker payout formula", () => {
  it.each([
    [0, 0],
    [1, 3],
    [2, 7],
    [3, 10],
    [4, 13],
    [5, 16],
    [6, 19],
  ])("%i completed+paid bookings -> %i BHD", (count, expected) => {
    expect(computeDailyPayout(count)).toBe(expected);
  });
});

const TODAY = "2026-07-22";

describe("computeFinancialSummary — worker aggregation", () => {
  it("computes total earnings for a single worker across multiple days using the payout formula", () => {
    const bookings = [
      makeBooking({ id: "b1", date: "2026-07-20" }), // 1 booking that day -> 3
      makeBooking({ id: "b2", date: "2026-07-21" }),
      makeBooking({ id: "b3", date: "2026-07-21" }), // 2 bookings that day -> 7
    ];
    const summary = computeFinancialSummary(bookings, "2026-07-01", "2026-07-31", TODAY);
    expect(summary.workers).toHaveLength(1);
    const w = summary.workers[0];
    expect(w.workerId).toBe("w1");
    expect(w.totalCompletedBookings).toBe(3);
    expect(w.totalPaidBookings).toBe(3);
    expect(w.totalEarnings).toBe(10); // 3 + 7
    expect(summary.workersTotal).toBe(10);
  });

  it("excludes unpaid bookings from earnings but still counts them as completed", () => {
    const bookings = [
      makeBooking({ id: "b1", date: "2026-07-20", paid: true }),
      makeBooking({ id: "b2", date: "2026-07-20", paid: false, paymentMethod: null, paidAmount: null }),
    ];
    const summary = computeFinancialSummary(bookings, "2026-07-01", "2026-07-31", TODAY);
    const w = summary.workers[0];
    expect(w.totalCompletedBookings).toBe(2);
    expect(w.totalPaidBookings).toBe(1);
    expect(w.totalEarnings).toBe(3); // only 1 paid booking that day
  });

  it("excludes cancelled bookings entirely", () => {
    const bookings = [makeBooking({ id: "b1", date: "2026-07-20", status: "cancelled" })];
    const summary = computeFinancialSummary(bookings, "2026-07-01", "2026-07-31", TODAY);
    expect(summary.workers).toHaveLength(0);
  });

  it("excludes future-dated bookings — not yet completed even if already paid", () => {
    const bookings = [makeBooking({ id: "b1", date: "2026-08-01", paid: true })];
    const summary = computeFinancialSummary(bookings, "2026-07-01", "2026-08-31", TODAY);
    expect(summary.workers).toHaveLength(0);
  });

  it("computes overallTotal from paidAmount (falling back to amount) and managerNet as the difference", () => {
    const bookings = [
      makeBooking({ id: "b1", date: "2026-07-20", paidAmount: 12, amount: 10 }),
      makeBooking({ id: "b2", date: "2026-07-20", paidAmount: null, amount: 8 }), // legacy: falls back to amount
    ];
    const summary = computeFinancialSummary(bookings, "2026-07-01", "2026-07-31", TODAY);
    expect(summary.overallTotal).toBe(20); // 12 + 8
    expect(summary.workersTotal).toBe(7); // 2 bookings same day -> 7
    expect(summary.managerNet).toBe(13); // 20 - 7
  });

  it("keeps separate workers' daily payouts independent", () => {
    const bookings = [
      makeBooking({ id: "b1", date: "2026-07-20", workerId: "w1", workerName: "سارة" }),
      makeBooking({ id: "b2", date: "2026-07-20", workerId: "w2", workerName: "منى" }),
    ];
    const summary = computeFinancialSummary(bookings, "2026-07-01", "2026-07-31", TODAY);
    expect(summary.workers).toHaveLength(2);
    for (const w of summary.workers) {
      expect(w.totalEarnings).toBe(3); // each worker has exactly 1 booking that day
    }
    expect(summary.workersTotal).toBe(6);
  });

  it("aggregates daily earnings into weekly and monthly breakdowns", () => {
    const bookings = [
      makeBooking({ id: "b1", date: "2026-07-01" }), // Wednesday
      makeBooking({ id: "b2", date: "2026-07-08" }), // next week, same weekday
      makeBooking({ id: "b3", date: "2026-07-08" }), // 2 that day -> 7
    ];
    const summary = computeFinancialSummary(bookings, "2026-07-01", "2026-07-31", TODAY);
    const w = summary.workers[0];
    expect(w.daily).toHaveLength(2);
    expect(w.monthly).toEqual([{ period: "2026-07", completedBookings: 3, paidBookings: 3, earnings: 10 }]);
    const weeklyTotal = w.weekly.reduce((sum, wk) => sum + wk.earnings, 0);
    expect(weeklyTotal).toBe(10);
  });
});
