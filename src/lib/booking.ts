import type { BookingSource, PaymentMethod, Shift } from "./types";

/**
 * Thin client-side wrappers around the booking API routes. All actual writes
 * to `bookings`/`slots` happen server-side under the Admin SDK (see
 * src/lib/server/bookingService.ts) — the client never talks to Firestore
 * directly at all, for any collection. Identity (`createdBy`, etc.) is
 * derived server-side from the manager session cookie (or the anonymous
 * employee identity when it's absent), never from anything the client sends.
 */

export const BOOKING_CONFLICT_MESSAGE_AR = "تم حجز العاملة للتو، اختر عاملة أخرى.";

export class ApiError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = "ApiError";
    this.code = code;
  }
}

export class BookingConflictError extends ApiError {
  constructor(message: string = BOOKING_CONFLICT_MESSAGE_AR) {
    super(message, "SLOT_CONFLICT");
    this.name = "BookingConflictError";
  }
}

async function callApi(url: string, method: "POST" | "PATCH", body: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string; code?: string; [key: string]: unknown };
  if (!res.ok) {
    const message = data.error || "حدث خطأ غير متوقع";
    const code = data.code || "UNKNOWN";
    if (code === "SLOT_CONFLICT") throw new BookingConflictError(message);
    throw new ApiError(message, code);
  }
  return data;
}

export interface CreateBookingInput {
  date: string;
  shift: Shift;
  workerId: string;
  workerName: string;
  areaId: string;
  areaName: string;
  hours: number;
  amount: number;
  customerPhone: string;
  customerLocation: string;
  source: BookingSource;
  recurringSeriesId: string | null;
}

export async function createBooking(input: CreateBookingInput): Promise<string> {
  const data = await callApi("/api/bookings", "POST", input);
  return data.id as string;
}

/**
 * Never includes payment — see updateBookingPayment, the only way payment
 * ever changes. date/shift/workerId/workerName ("Edit booking date" /
 * "Change worker") are optional and manager-only — omit them for a plain
 * area/hours/phone/location edit that must never move the booking.
 */
export interface EditableBookingFields {
  areaId: string;
  areaName: string;
  hours: number;
  amount: number;
  customerPhone: string;
  customerLocation: string;
  date?: string;
  shift?: Shift;
  workerId?: string;
  workerName?: string;
}

export async function updateBookingFields(bookingId: string, patch: EditableBookingFields): Promise<void> {
  await callApi(`/api/bookings/${bookingId}`, "PATCH", patch);
}

export async function cancelBooking(
  bookingId: string,
  options: { reason: string | null; cancelScope: "single" | "forward" }
): Promise<void> {
  await callApi(`/api/bookings/${bookingId}/cancel`, "POST", options);
}

export interface PaymentPatch {
  isPaid: boolean;
  paymentMethod: PaymentMethod | null;
  paidAmount: number | null;
}

/** Manager only — the server rejects this for any non-manager session. */
export async function updateBookingPayment(bookingId: string, patch: PaymentPatch): Promise<void> {
  await callApi(`/api/bookings/${bookingId}/payment`, "PATCH", patch);
}

export type RouteStatusAction = "drop_off" | "pickup" | "reset_drop_off" | "reset_pickup";

/**
 * "drop_off"/"pickup" are open to any session (this is the one write an
 * employee is allowed to make); "reset_drop_off"/"reset_pickup" are
 * manager-only and rejected server-side otherwise.
 */
export async function updateBookingRouteStatus(bookingId: string, action: RouteStatusAction): Promise<void> {
  await callApi(`/api/bookings/${bookingId}/route-status`, "PATCH", { action });
}
