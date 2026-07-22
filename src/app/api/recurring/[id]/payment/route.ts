import { NextResponse } from "next/server";
import { getActor, isManagerSession } from "@/lib/auth/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { ServiceError, type PaymentPatch } from "@/lib/server/bookingService";
import { setRecurringOccurrencePaymentServer } from "@/lib/server/recurringService";
import type { RecurringSchedule } from "@/lib/types";

interface PaymentBody {
  recurring: RecurringSchedule;
  date: string;
  isPaid: boolean;
  paymentMethod: "benefit" | "cash" | null;
  paidAmount: number | null;
}

/**
 * Sets the payment status for one occurrence of a recurring schedule,
 * materializing it first if it hasn't been booked as a concrete document
 * yet. Manager only.
 */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!(await isManagerSession())) {
    return NextResponse.json({ error: "هذا الإجراء متاح للمدير فقط" }, { status: 401 });
  }

  const { id } = await context.params;
  const body = (await request.json().catch(() => ({}))) as Partial<PaymentBody>;

  if (body.recurring?.id !== id || !body.date) {
    return NextResponse.json({ error: "بيانات غير متطابقة" }, { status: 400 });
  }

  const patch: PaymentPatch = {
    isPaid: body.isPaid === true,
    paymentMethod: body.paymentMethod === "benefit" || body.paymentMethod === "cash" ? body.paymentMethod : null,
    paidAmount: typeof body.paidAmount === "number" ? body.paidAmount : null,
  };

  try {
    await setRecurringOccurrencePaymentServer(
      getAdminDb(),
      { recurring: body.recurring, date: body.date, payment: patch },
      await getActor()
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    return NextResponse.json({ error: "تعذر تسجيل الدفع" }, { status: 500 });
  }
}
