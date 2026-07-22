import { NextResponse } from "next/server";
import { getActor, isManagerSession } from "@/lib/auth/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { ServiceError, updateBookingPaymentServer, type PaymentPatch } from "@/lib/server/bookingService";

/**
 * The only route that ever changes a booking's payment fields. Manager
 * only — employees never see payment information, and this route existing
 * at all is gated on that, not just the UI hiding a button.
 */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!(await isManagerSession())) {
    return NextResponse.json({ error: "هذا الإجراء متاح للمدير فقط" }, { status: 401 });
  }

  const { id } = await context.params;
  const body = (await request.json().catch(() => ({}))) as Partial<PaymentPatch>;
  const patch: PaymentPatch = {
    isPaid: body.isPaid === true,
    paymentMethod: body.paymentMethod === "benefit" || body.paymentMethod === "cash" ? body.paymentMethod : null,
    paidAmount: typeof body.paidAmount === "number" ? body.paidAmount : null,
  };

  try {
    await updateBookingPaymentServer(getAdminDb(), id, patch, await getActor());
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    return NextResponse.json({ error: "تعذر تسجيل الدفع" }, { status: 500 });
  }
}
