import { NextResponse } from "next/server";
import { isManagerSession } from "@/lib/auth/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { computePaymentSummary } from "@/lib/server/paymentSummary";

export async function GET() {
  if (!(await isManagerSession())) {
    return NextResponse.json({ error: "هذا الإجراء متاح للمدير فقط" }, { status: 401 });
  }

  const summary = await computePaymentSummary(getAdminDb());
  return NextResponse.json({ summary });
}
