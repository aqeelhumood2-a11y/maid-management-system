import { NextResponse } from "next/server";
import { getActor } from "@/lib/auth/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { ServiceError } from "@/lib/server/bookingService";
import { createRecurringScheduleServer, type CreateRecurringInput } from "@/lib/server/recurringService";
import type { RecurringSchedule } from "@/lib/types";

/** Read is open to everyone — the schedule grid needs active recurring schedules to compute availability. */
export async function GET() {
  const snap = await getAdminDb().collection("recurringSchedules").where("status", "==", "active").get();
  const schedules = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as RecurringSchedule);
  return NextResponse.json({ schedules });
}

export async function POST(request: Request) {
  const body = (await request.json()) as CreateRecurringInput;

  try {
    const id = await createRecurringScheduleServer(getAdminDb(), body, await getActor());
    return NextResponse.json({ id });
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    return NextResponse.json({ error: "تعذر إنشاء الجدول المتكرر" }, { status: 500 });
  }
}
