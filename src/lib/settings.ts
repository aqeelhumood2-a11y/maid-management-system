import { ApiError } from "./booking";

/** Thin client-side wrapper around the settings API route. See the note in areas.ts. */
export async function updateSettings(businessName: string): Promise<void> {
  const res = await fetch("/api/settings", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ businessName }),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
  if (!res.ok) {
    throw new ApiError(data.error || "حدث خطأ غير متوقع", data.code || "UNKNOWN");
  }
}

/** Manager only — the server verifies currentPassword before accepting newPassword. */
export async function changeManagerPassword(currentPassword: string, newPassword: string): Promise<void> {
  const res = await fetch("/api/manager/password", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ currentPassword, newPassword }),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
  if (!res.ok) {
    throw new ApiError(data.error || "حدث خطأ غير متوقع", data.code || "UNKNOWN");
  }
}

export interface PaymentStatsInitResult {
  cashTotal: number;
  benefitTotal: number;
  bookingsScanned: number;
}

/**
 * Manager only, and meant to run exactly once, ever — see
 * initializePaymentStatsServer in src/lib/server/paymentSummary.ts. A
 * repeat call throws an ApiError with code "ALREADY_INITIALIZED" rather
 * than re-summing and doubling the totals.
 */
export async function initializePaymentStats(): Promise<PaymentStatsInitResult> {
  const res = await fetch("/api/manager/payment-stats/initialize", { method: "POST" });
  const data = (await res.json().catch(() => ({}))) as {
    error?: string;
    code?: string;
    cashTotal?: number;
    benefitTotal?: number;
    bookingsScanned?: number;
  };
  if (!res.ok) {
    throw new ApiError(data.error || "حدث خطأ غير متوقع", data.code || "UNKNOWN");
  }
  return {
    cashTotal: data.cashTotal ?? 0,
    benefitTotal: data.benefitTotal ?? 0,
    bookingsScanned: data.bookingsScanned ?? 0,
  };
}
