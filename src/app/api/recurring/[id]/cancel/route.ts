import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { ServiceError } from "@/lib/server/bookingService";
import { cancelRecurringOccurrenceServer, type RecurringCancelScope } from "@/lib/server/recurringService";
import type { RecurringSchedule } from "@/lib/types";

interface CancelBody {
  recurring: RecurringSchedule;
  date: string;
  scope: RecurringCancelScope;
  reason: string | null;
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getServerSession();
  if (!session) return NextResponse.json({ error: "يجب تسجيل الدخول" }, { status: 401 });

  const { id } = await context.params;
  const body = (await request.json()) as CancelBody;

  if (body.recurring?.id !== id) {
    return NextResponse.json({ error: "بيانات غير متطابقة" }, { status: 400 });
  }

  try {
    await cancelRecurringOccurrenceServer(
      getAdminDb(),
      { recurring: body.recurring, date: body.date, scope: body.scope, reason: body.reason ?? null },
      session
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    return NextResponse.json({ error: "تعذر تنفيذ الإلغاء" }, { status: 500 });
  }
}
