import { NextResponse } from "next/server";
import { getActor, isManagerSession } from "@/lib/auth/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { ServiceError, updateBookingServer, type BookingPatch } from "@/lib/server/bookingService";

/**
 * area/hours/amount/customer info are always forwarded; date/shift/workerId
 * ("Edit booking date" / "Change worker") are forwarded only when present in
 * the request body, so a plain area/hours/phone/location edit never
 * accidentally moves the booking. Payment is not editable through this
 * route at all — see /api/bookings/[id]/payment, the only route that ever
 * touches it. Manager-only end to end — see the PATCH handler below.
 */
function pickEditableFields(body: Record<string, unknown>): BookingPatch {
  const patch: BookingPatch = {
    areaId: String(body.areaId ?? ""),
    areaName: String(body.areaName ?? ""),
    hours: Number(body.hours),
    amount: Number(body.amount),
    customerName: String(body.customerName ?? ""),
    customerPhone: String(body.customerPhone ?? ""),
    customerLocation: String(body.customerLocation ?? ""),
  };
  if (typeof body.date === "string") patch.date = body.date;
  if (body.shift === "morning" || body.shift === "afternoon") patch.shift = body.shift;
  if (typeof body.workerId === "string" && body.workerId) patch.workerId = body.workerId;
  if (typeof body.workerName === "string" && body.workerName) patch.workerName = body.workerName;
  return patch;
}

/** Manager only — editing a booking is no longer available to employees. */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!(await isManagerSession())) {
    return NextResponse.json({ error: "هذا الإجراء متاح للمدير فقط" }, { status: 401 });
  }
  const { id } = await context.params;
  const body = (await request.json()) as Record<string, unknown>;

  try {
    await updateBookingServer(getAdminDb(), id, pickEditableFields(body), await getActor());
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    return NextResponse.json({ error: "تعذر حفظ التعديل" }, { status: 500 });
  }
}
