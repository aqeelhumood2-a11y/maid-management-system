import { ApiError } from "./booking";

/**
 * Thin client-side wrappers around the areas API routes. Areas used to be
 * written directly from the browser to Firestore under Security Rules
 * keyed on Firebase Auth — now that there's no more Firebase Authentication,
 * every write happens server-side under the Admin SDK instead (see
 * src/lib/server/catalogService.ts), gated by the manager session cookie.
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

export async function createArea(name: string): Promise<string> {
  const data = await callApi("/api/areas", "POST", { name });
  return data.id as string;
}

export async function updateArea(areaId: string, name: string): Promise<void> {
  await callApi(`/api/areas/${areaId}`, "PATCH", { name });
}

export async function setAreaActive(areaId: string, active: boolean): Promise<void> {
  await callApi(`/api/areas/${areaId}`, "PATCH", { active });
}
