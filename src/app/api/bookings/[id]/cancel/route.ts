import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { cancelBookingServer, ServiceError } from "@/lib/server/bookingService";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getServerSession();
  if (!session) return NextResponse.json({ error: "يجب تسجيل الدخول" }, { status: 401 });

  const { id } = await context.params;
  const body = (await request.json()) as { reason?: string | null; cancelScope?: "single" | "forward" };
  const cancelScope = body.cancelScope === "forward" ? "forward" : "single";

  try {
    await cancelBookingServer(getAdminDb(), id, { reason: body.reason ?? null, cancelScope }, session);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    return NextResponse.json({ error: "تعذر إلغاء الحجز" }, { status: 500 });
  }
}
