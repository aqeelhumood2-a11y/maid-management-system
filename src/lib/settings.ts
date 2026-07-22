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
