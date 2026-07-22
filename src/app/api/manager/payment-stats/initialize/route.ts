import { NextResponse } from "next/server";
import { getActor, isManagerSession } from "@/lib/auth/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { initializePaymentStatsServer } from "@/lib/server/paymentSummary";
import { ServiceError } from "@/lib/server/errors";

/**
 * One-time, explicit, manager-only seeding of the payment-stats aggregate
 * from existing historical bookings (see initializePaymentStatsServer for
 * why this is the only place in the whole payment-summary fix that scans
 * full paid-booking history). Never invoked automatically anywhere — no
 * build step, no page load, no cron calls this route; a manager must POST
 * to it explicitly and exactly once. Calling it again after the first
 * successful run is rejected (ALREADY_INITIALIZED) rather than
 * double-counting the totals.
 */
export async function POST() {
  if (!(await isManagerSession())) {
    return NextResponse.json({ error: "هذا الإجراء متاح للمدير فقط" }, { status: 401 });
  }

  try {
    const result = await initializePaymentStatsServer(getAdminDb(), await getActor());
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    return NextResponse.json({ error: "تعذر تهيئة إحصائيات المدفوعات" }, { status: 500 });
  }
}
