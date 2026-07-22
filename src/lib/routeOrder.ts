import { ApiError } from "./booking";
import type { Shift } from "./types";

/** Thin client-side wrapper around the Daily Route ordering API route. */
export async function getRouteOrder(date: string, shift: Shift): Promise<string[]> {
  const res = await fetch(`/api/routes/order?date=${date}&shift=${shift}`);
  if (!res.ok) throw new Error("تعذر تحميل ترتيب خط السير");
  const json = (await res.json()) as { workerIds?: string[] };
  return json.workerIds ?? [];
}

/** Manager only — the server rejects this for any non-manager session. */
export async function saveRouteOrder(date: string, shift: Shift, workerIds: string[]): Promise<void> {
  const res = await fetch("/api/routes/order", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ date, shift, workerIds }),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
  if (!res.ok) {
    throw new ApiError(data.error || "حدث خطأ غير متوقع", data.code || "UNKNOWN");
  }
}

/**
 * Stably sorts `items` by a saved worker-id order: items whose worker id
 * appears in `workerIds` come first, in that exact order; anything not in
 * the saved order is appended afterward, keeping its original relative
 * order — so a new booking or worker never disappears, it just lands at the
 * end until the manager reorders again.
 */
export function applyRouteOrder<T>(items: T[], workerIds: string[], getWorkerId: (item: T) => string): T[] {
  const rank = new Map(workerIds.map((id, index) => [id, index]));
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const rankA = rank.get(getWorkerId(a.item)) ?? Number.MAX_SAFE_INTEGER;
      const rankB = rank.get(getWorkerId(b.item)) ?? Number.MAX_SAFE_INTEGER;
      if (rankA !== rankB) return rankA - rankB;
      return a.index - b.index; // stable fallback for items outside the saved order
    })
    .map((x) => x.item);
}
