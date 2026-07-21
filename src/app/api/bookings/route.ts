import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { createBookingServer, ServiceError, type CreateBookingInput } from "@/lib/server/bookingService";

export async function POST(request: Request) {
  const session = await getServerSession();
  if (!session) return NextResponse.json({ error: "يجب تسجيل الدخول" }, { status: 401 });

  const body = (await request.json()) as CreateBookingInput;

  try {
    const id = await createBookingServer(getAdminDb(), body, session);
    return NextResponse.json({ id });
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    return NextResponse.json({ error: "تعذر حفظ الحجز" }, { status: 500 });
  }
}
