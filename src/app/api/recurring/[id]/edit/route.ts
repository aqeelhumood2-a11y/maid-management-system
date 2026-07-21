import { NextResponse } from "next/server";
import { getActor } from "@/lib/auth/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { ServiceError, type BookingPatch } from "@/lib/server/bookingService";
import { editRecurringOccurrenceServer, type RecurringEditScope } from "@/lib/server/recurringService";
import type { RecurringSchedule } from "@/lib/types";

interface EditBody {
  recurring: RecurringSchedule;
  date: string;
  scope: RecurringEditScope;
  fields: Omit<BookingPatch, "date" | "shift" | "workerId" | "workerName">;
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const body = (await request.json()) as EditBody;

  if (body.recurring?.id !== id) {
    return NextResponse.json({ error: "بيانات غير متطابقة" }, { status: 400 });
  }

  try {
    await editRecurringOccurrenceServer(
      getAdminDb(),
      { recurring: body.recurring, date: body.date, scope: body.scope, fields: body.fields },
      await getActor()
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    return NextResponse.json({ error: "تعذر حفظ التعديل" }, { status: 500 });
  }
}
