import { ApiError } from "./booking";

/**
 * Thin client-side wrappers around the workers API routes. See the note in
 * areas.ts — all writes now happen server-side under the Admin SDK, gated
 * by the manager session cookie.
 */

async function callApi(
  url: string,
  method: "POST" | "PATCH" | "DELETE",
  body: unknown
): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string; code?: string; [key: string]: unknown };
  if (!res.ok) {
    throw new ApiError(data.error || "حدث خطأ غير متوقع", data.code || "UNKNOWN");
  }
  return data;
}

export async function createWorker(input: { name: string; phone: string }): Promise<string> {
  const data = await callApi("/api/workers", "POST", input);
  return data.id as string;
}

export async function updateWorker(workerId: string, patch: { name: string; phone: string }): Promise<void> {
  await callApi(`/api/workers/${workerId}`, "PATCH", patch);
}

export async function setWorkerActive(workerId: string, active: boolean): Promise<void> {
  await callApi(`/api/workers/${workerId}`, "PATCH", { active });
}

/** Permanent deletion — the worker document is removed from Firestore entirely. Historical bookings/recurring schedules are never touched. */
export async function deleteWorker(workerId: string): Promise<void> {
  await callApi(`/api/workers/${workerId}`, "DELETE", undefined);
}

export interface WorkerImpact {
  futureBookings: number;
  activeRecurringSchedules: number;
}

/** Used before deactivating a worker, to warn the manager if it would affect future operations. */
export async function getWorkerImpact(workerId: string): Promise<WorkerImpact> {
  const res = await fetch(`/api/workers/${workerId}/impact`);
  const data = (await res.json().catch(() => ({}))) as { error?: string; code?: string } & Partial<WorkerImpact>;
  if (!res.ok) throw new ApiError(data.error || "حدث خطأ غير متوقع", data.code || "UNKNOWN");
  return {
    futureBookings: data.futureBookings ?? 0,
    activeRecurringSchedules: data.activeRecurringSchedules ?? 0,
  };
}
