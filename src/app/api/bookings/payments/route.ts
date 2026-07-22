import { NextResponse } from "next/server";
import type { Firestore, Query } from "firebase-admin/firestore";
import { isManagerSession } from "@/lib/auth/server";
import { getAdminDb } from "@/lib/firebase/admin";
import type { Booking } from "@/lib/types";

export type PaymentFilter = "all" | "paid" | "unpaid" | "cash" | "benefit";

// "unpaid" is inherently bounded — only currently-outstanding bookings, the
// actionable set a manager needs to see in full. The other filters
// (paid/all/cash/benefit) read from the ever-growing paid-history instead,
// which is exactly the kind of unbounded scan that exhausted the Firestore
// quota when polled continuously — capped to the most recent N so a poll of
// this endpoint can never re-read the entire payment history at once.
export const PAID_HISTORY_LIMIT = 500;

/** Exported for testing the exact query shape against the emulator without mocking Next's Request/cookies. */
export function buildPaymentsQuery(db: Firestore, filter: PaymentFilter): Query {
  const query: Query = db.collection("bookings").where("status", "==", "active");

  if (filter === "unpaid") {
    return query.where("paid", "==", false).orderBy("date", "asc");
  }
  if (filter === "paid") {
    return query.where("paid", "==", true).orderBy("date", "desc").limit(PAID_HISTORY_LIMIT);
  }
  if (filter === "cash" || filter === "benefit") {
    return query
      .where("paid", "==", true)
      .where("paymentMethod", "==", filter === "cash" ? "cash" : "benefit")
      .orderBy("date", "desc")
      .limit(PAID_HISTORY_LIMIT);
  }
  return query.orderBy("date", "desc").limit(PAID_HISTORY_LIMIT);
}

/**
 * Manager-only listing of bookings by payment status, backing the Payments
 * page's All/Paid/Unpaid/Cash/BenefitPay filter. Deliberately a separate
 * route from the public GET /api/bookings — that one strips payment fields
 * entirely for non-managers, so payment data is never reachable from an
 * employee session through any route, not just hidden in the UI.
 */
export async function GET(request: Request) {
  if (!(await isManagerSession())) {
    return NextResponse.json({ error: "هذا الإجراء متاح للمدير فقط" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const filter = (searchParams.get("filter") as PaymentFilter | null) ?? "unpaid";

  const snap = await buildPaymentsQuery(getAdminDb(), filter).get();
  const bookings = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Booking);
  return NextResponse.json({ bookings });
}
