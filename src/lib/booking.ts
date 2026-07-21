import type { BookingSource, PaymentMethod, Shift } from "./types";

/**
 * Thin client-side wrappers around the booking API routes. All actual writes
 * to `bookings`/`slots` happen server-side under the Admin SDK (see
 * src/lib/server/bookingService.ts) — the client never talks to Firestore
 * for these collections directly, and Firestore rules deny it outright.
 * Identity (`createdBy`, etc.) is derived server-side from the verified
 * session cookie, never from anything the client sends.
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

/** Kept for the other client-side write modules (workers/areas/settings) that still write directly to Firestore. */
export interface ActingUser {
  uid: string;
  email: string;
  name: string;
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
  paymentMethod: PaymentMethod | null;
  customerPhone: string;
  customerLocation: string;
  source: BookingSource;
  recurringSeriesId: string | null;
}

export async function createBooking(input: CreateBookingInput): Promise<string> {
  const data = await callApi("/api/bookings", "POST", input);
  return data.id as string;
}

export interface EditableBookingFields {
  areaId: string;
  areaName: string;
  hours: number;
  amount: number;
  paymentMethod: PaymentMethod | null;
  customerPhone: string;
  customerLocation: string;
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

export async function markBookingPaid(
  bookingId: string,
  options: { paymentMethod: PaymentMethod }
): Promise<void> {
  await callApi(`/api/bookings/${bookingId}/mark-paid`, "POST", options);
}
