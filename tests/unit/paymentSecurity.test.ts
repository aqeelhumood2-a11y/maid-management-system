import { describe, expect, it } from "vitest";
import { redactEmployeeRestrictedFields, redactPaymentFields } from "@/lib/server/bookingService";
import type { Booking } from "@/lib/types";

/**
 * Requirement #7 (and the later approved permissions spec): employees must
 * never see payment information, and — per the exhaustive employee
 * allow-list ("view booking/area/phone/location/duration/route status,
 * nothing else") — never the booking amount either. This is a regression
 * guard on the exact functions GET /api/bookings uses to redact a booking
 * before it ever reaches a non-manager session.
 */

function paidBooking(overrides: Partial<Booking> = {}): Booking {
  return {
    id: "b1",
    date: "2026-07-22",
    shift: "morning",
    workerId: "w1",
    workerName: "سارة",
    areaId: "a1",
    areaName: "المنامة",
    hours: 4,
    amount: 12,
    paymentMethod: "cash",
    paid: true,
    paidAmount: 12,
    paymentDate: { _seconds: 1700000000, _nanoseconds: 0 },
    paymentBy: "manager",
    dropOffAt: null,
    pickupAt: null,
    customerName: "أحمد",
    customerPhone: "36000000",
    customerLocation: "قريب من السوق",
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

describe("redactPaymentFields — employee-facing schedule reads", () => {
  it("strips every payment field from a paid booking", () => {
    const redacted = redactPaymentFields(paidBooking());
    expect(redacted.paid).toBe(false);
    expect(redacted.paymentMethod).toBeNull();
    expect(redacted.paidAmount).toBeNull();
    expect(redacted.paymentDate).toBeNull();
    expect(redacted.paymentBy).toBeNull();
  });

  it("leaves every non-payment field untouched", () => {
    const original = paidBooking();
    const redacted = redactPaymentFields(original);
    expect(redacted.id).toBe(original.id);
    expect(redacted.workerName).toBe(original.workerName);
    expect(redacted.areaName).toBe(original.areaName);
    expect(redacted.customerPhone).toBe(original.customerPhone);
    expect(redacted.amount).toBe(original.amount);
  });

  it("is a no-op shape-wise on an already-unpaid booking", () => {
    const unpaid = paidBooking({
      paid: false,
      paymentMethod: null,
      paidAmount: null,
      paymentDate: null,
      paymentBy: null,
    });
    expect(redactPaymentFields(unpaid)).toEqual(unpaid);
  });
});

describe("redactEmployeeRestrictedFields — Daily/Route Schedule reads", () => {
  it("strips every payment field and zeroes the amount", () => {
    const redacted = redactEmployeeRestrictedFields(paidBooking());
    expect(redacted.paid).toBe(false);
    expect(redacted.paymentMethod).toBeNull();
    expect(redacted.paidAmount).toBeNull();
    expect(redacted.paymentDate).toBeNull();
    expect(redacted.paymentBy).toBeNull();
    expect(redacted.amount).toBe(0);
  });

  it("leaves the explicitly-allowed employee-visible fields untouched", () => {
    const original = paidBooking();
    const redacted = redactEmployeeRestrictedFields(original);
    expect(redacted.workerName).toBe(original.workerName);
    expect(redacted.areaName).toBe(original.areaName);
    expect(redacted.customerPhone).toBe(original.customerPhone);
    expect(redacted.customerLocation).toBe(original.customerLocation);
    expect(redacted.hours).toBe(original.hours);
    expect(redacted.dropOffAt).toEqual(original.dropOffAt);
    expect(redacted.pickupAt).toEqual(original.pickupAt);
  });
});
