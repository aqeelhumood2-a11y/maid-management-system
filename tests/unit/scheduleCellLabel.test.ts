import { describe, expect, it } from "vitest";
import { cellLabel } from "@/components/schedule/ScheduleTable";
import type { Booking, CellResolution, RecurringSchedule } from "@/lib/types";

function makeBooking(overrides: Partial<Booking> = {}): Booking {
  return {
    id: "b1",
    date: "2026-07-22",
    shift: "morning",
    workerId: "w1",
    workerName: "سارة",
    areaId: "a1",
    areaName: "سار 88",
    hours: 4,
    amount: 10,
    paymentMethod: null,
    paid: false,
    paidAmount: null,
    paymentDate: null,
    paymentBy: null,
    dropOffAt: null,
    pickupAt: null,
    customerPhone: "36001234",
    customerLocation: "منزل رقم 12، شارع 5",
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
    areaName: "سار 88",
    shift: "morning",
    dayOfWeek: 3,
    hours: 4,
    amount: 10,
    customerPhone: "36001234",
    customerLocation: "منزل رقم 12، شارع 5",
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

function resolution(overrides: Partial<CellResolution>): CellResolution {
  return { status: "available", booking: null, virtualOccurrence: null, ...overrides };
}

describe("cellLabel", () => {
  it("shows the generic labels for non-booked statuses, unchanged", () => {
    expect(cellLabel(resolution({ status: "available" }))).toBe("متاحة");
    expect(cellLabel(resolution({ status: "friday_holiday" }))).toBe("إجازة");
    expect(cellLabel(resolution({ status: "inactive" }))).toBe("غير نشطة");
  });

  it("shows the booking's typed area name for a materialized booking, not the generic 'محجوزة' text", () => {
    const booking = makeBooking({ areaName: "سار 88" });
    expect(cellLabel(resolution({ status: "booked", booking }))).toBe("سار 88");
  });

  it("shows the recurring schedule's typed area name for a not-yet-materialized occurrence", () => {
    const recurring = makeRecurring({ areaName: "سار 88" });
    expect(
      cellLabel(resolution({ status: "booked", virtualOccurrence: { recurring, exception: null } }))
    ).toBe("سار 88");
  });

  it("falls back to 'محجوزة' when a booking's area is unexpectedly empty (older data)", () => {
    const booking = makeBooking({ areaName: "" });
    expect(cellLabel(resolution({ status: "booked", booking }))).toBe("محجوزة");
  });

  it("falls back to 'محجوزة' when a recurring occurrence's area is unexpectedly empty", () => {
    const recurring = makeRecurring({ areaName: "   " });
    expect(
      cellLabel(resolution({ status: "booked", virtualOccurrence: { recurring, exception: null } }))
    ).toBe("محجوزة");
  });

  it("falls back to 'محجوزة' when a booked cell has neither a booking nor a virtual occurrence", () => {
    expect(cellLabel(resolution({ status: "booked" }))).toBe("محجوزة");
  });

  it("never includes the customer phone number or location in the label", () => {
    const booking = makeBooking({
      areaName: "سار 88",
      customerPhone: "36001234",
      customerLocation: "منزل رقم 12، شارع 5",
    });
    const label = cellLabel(resolution({ status: "booked", booking }));
    expect(label).toBe("سار 88");
    expect(label).not.toContain("36001234");
    expect(label).not.toContain("منزل رقم 12");
  });
});
