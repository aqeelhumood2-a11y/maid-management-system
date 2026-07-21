import { NextResponse } from "next/server";
import { getActor } from "@/lib/auth/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { createBookingServer, ServiceError, type CreateBookingInput } from "@/lib/server/bookingService";
import type { Booking } from "@/lib/types";

/**
 * Reads are open to everyone — employees need the live schedule with no
 * login at all. Supports the three query shapes the UI actually needs:
 *  - ?dates=2026-01-01,2026-01-02   active bookings on any of these dates
 *  - ?start=...&end=...             active bookings in an inclusive date range
 *  - ?unpaid=true                   active, unpaid bookings (manager-only view)
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const db = getAdminDb();

  const datesParam = searchParams.get("dates");
  const start = searchParams.get("start");
  const end = searchParams.get("end");
  const unpaid = searchParams.get("unpaid") === "true";

  let snap;
  if (datesParam) {
    const dates = datesParam.split(",").filter(Boolean).slice(0, 30);
    if (dates.length === 0) return NextResponse.json({ bookings: [] });
    snap = await db
      .collection("bookings")
      .where("date", "in", dates)
      .where("status", "==", "active")
      .get();
  } else if (start && end) {
    snap = await db
      .collection("bookings")
      .where("status", "==", "active")
      .where("date", ">=", start)
      .where("date", "<=", end)
      .orderBy("date", "asc")
      .get();
  } else if (unpaid) {
    snap = await db
      .collection("bookings")
      .where("paid", "==", false)
      .where("status", "==", "active")
      .orderBy("date", "asc")
      .get();
  } else {
    return NextResponse.json({ error: "معطيات الاستعلام غير مكتملة" }, { status: 400 });
  }

  const bookings = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Booking);
  return NextResponse.json({ bookings });
}

export async function POST(request: Request) {
  const body = (await request.json()) as CreateBookingInput;

  try {
    const id = await createBookingServer(getAdminDb(), body, await getActor());
    return NextResponse.json({ id });
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    return NextResponse.json({ error: "تعذر حفظ الحجز" }, { status: 500 });
  }
}
