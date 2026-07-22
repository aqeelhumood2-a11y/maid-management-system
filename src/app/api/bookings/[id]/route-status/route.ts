import { NextResponse } from "next/server";
import { getActor } from "@/lib/auth/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { ServiceError, updateBookingRouteStatusServer, type RouteStatusAction } from "@/lib/server/bookingService";

const VALID_ACTIONS: RouteStatusAction[] = ["drop_off", "pickup", "reset_drop_off", "reset_pickup"];

/**
 * The one write an employee session is allowed to make at all: marking a
 * booking's drop-off/pickup on the Route Schedule. No manager gate at the
 * route level — "drop_off"/"pickup" are open to both roles, and the reset
 * actions are rejected inside updateBookingRouteStatusServer itself for a
 * non-manager actor, matching how every other write in this app enforces
 * authorization in the trusted server layer rather than the route wiring.
 */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const body = (await request.json().catch(() => ({}))) as { action?: string };
  if (!VALID_ACTIONS.includes(body.action as RouteStatusAction)) {
    return NextResponse.json({ error: "إجراء غير صالح" }, { status: 400 });
  }

  try {
    await updateBookingRouteStatusServer(getAdminDb(), id, body.action as RouteStatusAction, await getActor());
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    return NextResponse.json({ error: "تعذر تحديث حالة خط السير" }, { status: 500 });
  }
}
