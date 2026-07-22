import type { Firestore } from "firebase-admin/firestore";

export const DEFAULT_BUSINESS_NAME = "نظام إدارة العاملات";

// A quota rejection fails fast, but an unreachable/degraded backend can hang
// for tens of seconds on gRPC's own retry/backoff before rejecting — long
// enough to trip a serverless function's own execution timeout. Race a short
// deadline so the fallback always wins quickly either way.
const SETTINGS_READ_TIMEOUT_MS = 4000;

/**
 * Every page (employee and manager alike) reads this once per request just
 * to render the header — it must never be the thing that takes the whole
 * site down. A transient Firestore failure (quota, cold-start blip, network)
 * degrades to the default name instead of throwing and 500ing the request.
 */
export async function getBusinessName(db: Firestore): Promise<string> {
  try {
    const snap = await Promise.race([
      db.collection("settings").doc("app").get(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("settings read timed out")), SETTINGS_READ_TIMEOUT_MS)
      ),
    ]);
    return (snap.data()?.businessName as string | undefined) || DEFAULT_BUSINESS_NAME;
  } catch {
    return DEFAULT_BUSINESS_NAME;
  }
}
