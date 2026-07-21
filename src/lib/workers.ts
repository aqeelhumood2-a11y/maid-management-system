import { ApiError } from "./booking";

/**
 * Thin client-side wrappers around the workers API routes. See the note in
 * areas.ts — all writes now happen server-side under the Admin SDK, gated
 * by the manager session cookie.
 */

async function callApi(url: string, method: "POST" | "PATCH", body: unknown): Promise<Record<string, unknown>> {
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
