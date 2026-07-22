import { NextResponse } from "next/server";
import { isManagerSession } from "@/lib/auth/server";
import { getAdminDb } from "@/lib/firebase/admin";
import type { Booking } from "@/lib/types";

export type PaymentFilter = "all" | "paid" | "unpaid" | "cash" | "benefit";

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

  const db = getAdminDb();
  let query: FirebaseFirestore.Query = db.collection("bookings").where("status", "==", "active");

  if (filter === "unpaid") {
    query = query.where("paid", "==", false).orderBy("date", "asc");
  } else if (filter === "paid") {
    query = query.where("paid", "==", true).orderBy("date", "desc");
  } else if (filter === "cash" || filter === "benefit") {
    query = query
      .where("paid", "==", true)
      .where("paymentMethod", "==", filter === "cash" ? "cash" : "benefit")
      .orderBy("date", "desc");
  } else {
    query = query.orderBy("date", "desc");
  }

  const snap = await query.get();
  const bookings = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Booking);
  return NextResponse.json({ bookings });
}
