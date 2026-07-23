import { NextResponse } from "next/server";
import { getActor, isManagerSession } from "@/lib/auth/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { todayBahrain } from "@/lib/date";
import { getWorkerFutureCommitmentsServer } from "@/lib/server/catalogService";
import { ServiceError } from "@/lib/server/errors";

/** Manager-only, read-only: counts a worker's future bookings and active recurring schedules, used to warn before deactivation. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!(await isManagerSession())) {
    return NextResponse.json({ error: "هذا الإجراء متاح للمدير فقط" }, { status: 401 });
  }

  const { id } = await context.params;

  try {
    const result = await getWorkerFutureCommitmentsServer(getAdminDb(), id, todayBahrain(), await getActor());
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    return NextResponse.json({ error: "تعذر التحقق من بيانات العاملة" }, { status: 500 });
  }
}
