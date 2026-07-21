import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { markBookingPaidServer, ServiceError } from "@/lib/server/bookingService";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getServerSession();
  if (!session) return NextResponse.json({ error: "يجب تسجيل الدخول" }, { status: 401 });

  const { id } = await context.params;
  const body = (await request.json()) as { paymentMethod?: "benefit" | "cash" };
  if (body.paymentMethod !== "benefit" && body.paymentMethod !== "cash") {
    return NextResponse.json({ error: "طريقة دفع غير صالحة" }, { status: 400 });
  }

  try {
    await markBookingPaidServer(getAdminDb(), id, { paymentMethod: body.paymentMethod }, session);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    return NextResponse.json({ error: "تعذر تسجيل الدفع" }, { status: 500 });
  }
}
