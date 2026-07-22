import { ApiError, type EditableBookingFields, type PaymentPatch } from "./booking";
import type { RecurringSchedule, Shift } from "./types";

/**
 * Thin client-side wrappers around the recurring-schedule API routes.
 * recurringSchedules/recurringExceptions are, like bookings/slots, written
 * exclusively server-side (see src/lib/server/recurringService.ts) —
 * Firestore rules deny direct client writes to these collections outright.
 */

export class InvalidRecurringDayError extends Error {
  constructor() {
    super("لا يمكن جدولة موعد متكرر يوم الجمعة، فهو يوم إجازة ثابت.");
    this.name = "InvalidRecurringDayError";
  }
}

async function callApi(url: string, body: unknown, method: "POST" | "PATCH" = "POST"): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string; code?: string; [key: string]: unknown };
  if (!res.ok) {
    throw new ApiError(data.error || "حدث خطأ غير متوقع", data.code || "UNKNOWN");
  }
  return data;
}

export interface CreateRecurringInput {
  workerId: string;
  workerName: string;
  areaId: string;
  areaName: string;
  shift: Shift;
  dayOfWeek: number;
  hours: number;
  amount: number;
  customerPhone: string;
  customerLocation: string;
  startDate: string;
}

export async function createRecurringSchedule(input: CreateRecurringInput): Promise<string> {
  if (input.dayOfWeek === 5) throw new InvalidRecurringDayError();
  const data = await callApi("/api/recurring", input);
  return data.id as string;
}

export type RecurringEditScope = "single" | "forward" | "entire";

export interface EditRecurringInput {
  recurring: RecurringSchedule;
  date: string; // the occurrence date the edit was triggered from
  scope: RecurringEditScope;
  fields: EditableBookingFields;
}

export async function editRecurringOccurrence(input: EditRecurringInput): Promise<void> {
  await callApi(`/api/recurring/${input.recurring.id}/edit`, input);
}

export type RecurringCancelScope = "single" | "forward";

export interface CancelRecurringInput {
  recurring: RecurringSchedule;
  date: string;
  scope: RecurringCancelScope;
  reason: string | null;
}

export async function cancelRecurringOccurrence(input: CancelRecurringInput): Promise<void> {
  await callApi(`/api/recurring/${input.recurring.id}/cancel`, input);
}

export interface SetRecurringOccurrencePaymentInput {
  recurring: RecurringSchedule;
  date: string;
  payment: PaymentPatch;
}

/** Manager only — materializes the occurrence into a concrete booking first if needed. */
export async function setRecurringOccurrencePayment(input: SetRecurringOccurrencePaymentInput): Promise<void> {
  await callApi(
    `/api/recurring/${input.recurring.id}/payment`,
    { recurring: input.recurring, date: input.date, ...input.payment },
    "PATCH"
  );
}

export function availableDaysOfWeek(): { value: number; labelAr: string }[] {
  return [
    { value: 0, labelAr: "الأحد" },
    { value: 1, labelAr: "الاثنين" },
    { value: 2, labelAr: "الثلاثاء" },
    { value: 3, labelAr: "الأربعاء" },
    { value: 4, labelAr: "الخميس" },
    { value: 6, labelAr: "السبت" },
  ];
}
