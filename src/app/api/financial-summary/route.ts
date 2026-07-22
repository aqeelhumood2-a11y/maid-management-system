import { NextResponse } from "next/server";
import { getActor, isManagerSession } from "@/lib/auth/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { getFinancialSummaryServer } from "@/lib/server/financialSummary";
import { ServiceError } from "@/lib/server/bookingService";

/**
 * Manager-only Financial Settlement summary for a date range. Requirement
 * #7: financial pages are manager-only, checked here before any Firestore
 * read, exactly like every other manager-only route in this app.
 */
export async function GET(request: Request) {
  if (!(await isManagerSession())) {
    return NextResponse.json({ error: "هذا الإجراء متاح للمدير فقط" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const start = searchParams.get("start");
  const end = searchParams.get("end");
  if (!start || !end) {
    return NextResponse.json({ error: "معطيات الاستعلام غير مكتملة" }, { status: 400 });
  }

  try {
    const summary = await getFinancialSummaryServer(getAdminDb(), start, end, await getActor());
    return NextResponse.json({ summary });
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    return NextResponse.json({ error: "تعذر حساب التسوية المالية" }, { status: 500 });
  }
}
