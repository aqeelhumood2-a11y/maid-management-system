import { NextResponse } from "next/server";
import { getActor } from "@/lib/auth/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { ServiceError, updateBookingServer, type BookingPatch } from "@/lib/server/bookingService";

/**
 * Only the approved editable fields (area/hours/amount/payment/customer info)
 * are ever forwarded to the service layer — date/shift/workerId are
 * intentionally stripped here even if present in the request body, since no
 * approved feature moves a booking to a different worker/date/shift.
 */
function pickEditableFields(body: Record<string, unknown>): Omit<BookingPatch, "date" | "shift" | "workerId" | "workerName"> {
  return {
    areaId: String(body.areaId ?? ""),
    areaName: String(body.areaName ?? ""),
    hours: Number(body.hours),
    amount: Number(body.amount),
    paymentMethod: body.paymentMethod === "benefit" || body.paymentMethod === "cash" ? body.paymentMethod : null,
    customerPhone: String(body.customerPhone ?? ""),
    customerLocation: String(body.customerLocation ?? ""),
  };
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
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
