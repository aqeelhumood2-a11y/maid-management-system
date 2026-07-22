import { NextResponse } from "next/server";
import { getActor } from "@/lib/auth/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { ServiceError, type RouteStatusAction } from "@/lib/server/bookingService";
import { setRecurringOccurrenceRouteStatusServer } from "@/lib/server/recurringService";
import type { RecurringSchedule } from "@/lib/types";

interface RouteStatusBody {
  recurring: RecurringSchedule;
  date: string;
  action: RouteStatusAction;
}

const VALID_ACTIONS: RouteStatusAction[] = ["drop_off", "pickup", "reset_drop_off", "reset_pickup"];

/**
 * Sets the transport status for one occurrence of a recurring schedule,
 * materializing it first if it hasn't been booked as a concrete document
 * yet. No manager gate here — see /api/bookings/[id]/route-status for why;
 * the reset actions are still rejected for a non-manager actor inside
 * setRecurringOccurrenceRouteStatusServer.
 */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const body = (await request.json().catch(() => ({}))) as Partial<RouteStatusBody>;

  if (body.recurring?.id !== id || !body.date || !VALID_ACTIONS.includes(body.action as RouteStatusAction)) {
    return NextResponse.json({ error: "بيانات غير متطابقة" }, { status: 400 });
  }

  try {
    await setRecurringOccurrenceRouteStatusServer(
      getAdminDb(),
      { recurring: body.recurring, date: body.date, action: body.action as RouteStatusAction },
      await getActor()
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    return NextResponse.json({ error: "تعذر تحديث حالة خط السير" }, { status: 500 });
  }
}
