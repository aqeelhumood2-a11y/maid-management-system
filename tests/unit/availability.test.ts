import { describe, expect, it } from "vitest";
import { findRecurringOccurrence, isEligibleForBooking, resolveCell, slotId } from "@/lib/availability";
import type { Booking, RecurringException, RecurringSchedule, Worker } from "@/lib/types";

function makeWorker(overrides: Partial<Worker> = {}): Worker {
  return {
    id: "w1",
    name: "سارة",
    phone: "3300000",
    active: true,
    createdAt: null,
    createdBy: "manager1",
    updatedAt: null,
    updatedBy: "manager1",
    ...overrides,
  };
}

function makeBooking(overrides: Partial<Booking> = {}): Booking {
  return {
    id: "b1",
    date: "2026-07-22",
    shift: "morning",
    workerId: "w1",
    workerName: "سارة",
    areaId: "a1",
    areaName: "المنامة",
    hours: 4,
    amount: 10,
    paymentMethod: null,
    paid: false,
    paymentDate: null,
    paymentBy: null,
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

function makeRecurring(overrides: Partial<RecurringSchedule> = {}): RecurringSchedule {
  return {
    id: "r1",
    workerId: "w1",
    workerName: "سارة",
    areaId: "a1",
    areaName: "المنامة",
    shift: "morning",
    dayOfWeek: 3, // Wednesday
    hours: 4,
    amount: 10,
    paymentMethod: null,
    customerPhone: "",
    customerLocation: "",
    startDate: "2026-01-01",
    endDate: null,
    status: "active",
    replacesId: null,
    createdBy: "manager1",
    createdAt: null,
    updatedBy: "manager1",
    updatedAt: null,
    ...overrides,
  };
}

describe("resolveCell", () => {
  it("marks an inactive worker as inactive regardless of bookings", () => {
    const worker = makeWorker({ active: false });
    const result = resolveCell(worker, "2026-07-22", "morning", [], [], []);
    expect(result.status).toBe("inactive");
  });

  it("returns available when nothing occupies the slot", () => {
    const worker = makeWorker();
    const result = resolveCell(worker, "2026-07-22", "morning", [], [], []);
    expect(result.status).toBe("available");
  });

  it("marks Friday as a holiday by default", () => {
    const worker = makeWorker();
    // 2026-07-24 is a Friday
    const result = resolveCell(worker, "2026-07-24", "morning", [], [], []);
    expect(result.status).toBe("friday_holiday");
  });

  it("allows an exceptional Friday booking to override the holiday", () => {
    const worker = makeWorker();
    const booking = makeBooking({ date: "2026-07-24", source: "manager_future" });
    const result = resolveCell(worker, "2026-07-24", "morning", [booking], [], []);
    expect(result.status).toBe("booked");
    expect(result.booking?.id).toBe("b1");
  });

  it("keeps other workers on holiday when one worker has an exceptional Friday booking", () => {
    const workerA = makeWorker({ id: "w1" });
    const workerB = makeWorker({ id: "w2" });
    const booking = makeBooking({ date: "2026-07-24", workerId: "w1" });
    expect(resolveCell(workerA, "2026-07-24", "morning", [booking], [], []).status).toBe("booked");
    expect(resolveCell(workerB, "2026-07-24", "morning", [booking], [], []).status).toBe("friday_holiday");
  });

  it("marks a slot booked from a direct active booking", () => {
    const worker = makeWorker();
    const booking = makeBooking();
    const result = resolveCell(worker, "2026-07-22", "morning", [booking], [], []);
    expect(result.status).toBe("booked");
  });

  it("ignores cancelled bookings for availability", () => {
    const worker = makeWorker();
    const booking = makeBooking({ status: "cancelled" });
    const result = resolveCell(worker, "2026-07-22", "morning", [booking], [], []);
    expect(result.status).toBe("available");
  });

  it("resolves a virtual occurrence from a recurring schedule with no materialized booking", () => {
    const worker = makeWorker();
    const recurring = makeRecurring(); // Wednesday morning
    const result = resolveCell(worker, "2026-07-22", "morning", [], [recurring], []); // 2026-07-22 is Wednesday
    expect(result.status).toBe("booked");
    expect(result.virtualOccurrence?.recurring.id).toBe("r1");
  });

  it("does not apply a recurring schedule outside its start/end range", () => {
    const worker = makeWorker();
    const recurring = makeRecurring({ startDate: "2026-08-01" });
    const result = resolveCell(worker, "2026-07-22", "morning", [], [recurring], []);
    expect(result.status).toBe("available");
  });

  it("releases a date excluded by a cancellation exception back to available", () => {
    const worker = makeWorker();
    const recurring = makeRecurring();
    const exception: RecurringException = {
      id: "r1_2026-07-22",
      recurringId: "r1",
      date: "2026-07-22",
      type: "cancelled",
      reason: null,
      createdBy: "manager1",
      createdAt: null,
    };
    const result = resolveCell(worker, "2026-07-22", "morning", [], [recurring], [exception]);
    expect(result.status).toBe("available");
  });

  it("prefers a materialized booking over the recurring pattern for the same date", () => {
    const worker = makeWorker();
    const recurring = makeRecurring();
    const booking = makeBooking({ date: "2026-07-22", recurringSeriesId: "r1", source: "recurring" });
    const result = resolveCell(worker, "2026-07-22", "morning", [booking], [recurring], []);
    expect(result.status).toBe("booked");
    expect(result.booking?.id).toBe("b1");
    expect(result.virtualOccurrence).toBeNull();
  });
});

describe("findRecurringOccurrence", () => {
  it("returns null when the shift does not match", () => {
    const recurring = makeRecurring({ shift: "morning" });
    expect(findRecurringOccurrence("w1", "2026-07-22", "afternoon", [recurring], [])).toBeNull();
  });

  it("finds the matching schedule for the given day of week", () => {
    const recurring = makeRecurring();
    const found = findRecurringOccurrence("w1", "2026-07-22", "morning", [recurring], []);
    expect(found?.recurring.id).toBe("r1");
  });
});

describe("isEligibleForBooking", () => {
  it("treats available and friday_holiday as eligible for a new booking", () => {
    expect(isEligibleForBooking("available")).toBe(true);
    expect(isEligibleForBooking("friday_holiday")).toBe(true);
  });

  it("treats booked and inactive as ineligible", () => {
    expect(isEligibleForBooking("booked")).toBe(false);
    expect(isEligibleForBooking("inactive")).toBe(false);
  });
});

describe("slotId", () => {
  it("builds a deterministic lock id from worker/date/shift", () => {
    expect(slotId("w1", "2026-07-22", "morning")).toBe("w1_2026-07-22_morning");
  });
});
