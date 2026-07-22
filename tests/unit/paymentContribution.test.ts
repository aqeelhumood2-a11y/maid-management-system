import { describe, expect, it } from "vitest";
import { paymentContribution } from "@/lib/server/bookingService";

/**
 * paymentContribution is the pure function every payment-affecting write
 * uses to compute the delta applied to settings/paymentStats — get this
 * wrong and the dashboard's all-time totals silently drift from reality.
 * Mirrors the exact semantics the old full-scan computePaymentSummary used:
 * only an ACTIVE + paid booking contributes, and the collected amount is
 * paidAmount if set, else amount (legacy fallback).
 */
describe("paymentContribution", () => {
  it("contributes nothing for a null state", () => {
    expect(paymentContribution(null)).toEqual({ cash: 0, benefit: 0 });
  });

  it("contributes nothing for an unpaid active booking", () => {
    expect(
      paymentContribution({ status: "active", paid: false, paymentMethod: null, paidAmount: null, amount: 10 })
    ).toEqual({ cash: 0, benefit: 0 });
  });

  it("contributes nothing for a cancelled booking even if paid", () => {
    expect(
      paymentContribution({ status: "cancelled", paid: true, paymentMethod: "cash", paidAmount: 12, amount: 12 })
    ).toEqual({ cash: 0, benefit: 0 });
  });

  it("contributes paidAmount to cashTotal for an active cash-paid booking", () => {
    expect(
      paymentContribution({ status: "active", paid: true, paymentMethod: "cash", paidAmount: 12, amount: 10 })
    ).toEqual({ cash: 12, benefit: 0 });
  });

  it("contributes paidAmount to benefitTotal for an active benefit-paid booking", () => {
    expect(
      paymentContribution({ status: "active", paid: true, paymentMethod: "benefit", paidAmount: 8, amount: 10 })
    ).toEqual({ cash: 0, benefit: 8 });
  });

  it("falls back to `amount` when paidAmount is null (legacy pre-paidAmount-field booking)", () => {
    expect(
      paymentContribution({ status: "active", paid: true, paymentMethod: "cash", paidAmount: null, amount: 9 })
    ).toEqual({ cash: 9, benefit: 0 });
  });

  it("contributes nothing when paid but paymentMethod is somehow null (defensive)", () => {
    expect(
      paymentContribution({ status: "active", paid: true, paymentMethod: null, paidAmount: 10, amount: 10 })
    ).toEqual({ cash: 0, benefit: 0 });
  });
});
