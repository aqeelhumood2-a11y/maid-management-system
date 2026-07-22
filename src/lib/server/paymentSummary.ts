import type { Firestore, Timestamp } from "firebase-admin/firestore";
import { dateInBahrain, todayBahrain, weekDates, weekStart } from "../date";
import type { PaymentMethod } from "../types";

export interface PaymentSummary {
  totalUnpaid: number;
  totalPaidToday: number;
  totalPaidThisWeek: number;
  cashTotal: number;
  benefitTotal: number;
  grandTotal: number;
}

/**
 * Backs the manager dashboard's Payment Summary card. Reads real Admin SDK
 * documents directly (not the client-facing serialized shape), so
 * `paymentDate` is a genuine Firestore Timestamp with `.toDate()` here.
 *
 * Migration note: bookings paid before `paidAmount` existed as a field have
 * `paidAmount === undefined` in Firestore — falls back to the booking's own
 * `amount` for those, which is the only sensible "what was actually
 * collected" answer without a data backfill, and keeps the totals correct
 * without requiring any manual migration step.
 */
export async function computePaymentSummary(db: Firestore): Promise<PaymentSummary> {
  const [unpaidSnap, paidSnap] = await Promise.all([
    db.collection("bookings").where("status", "==", "active").where("paid", "==", false).get(),
    db.collection("bookings").where("status", "==", "active").where("paid", "==", true).get(),
  ]);

  const totalUnpaid = unpaidSnap.docs.reduce((sum, d) => sum + (Number(d.data().amount) || 0), 0);

  const today = todayBahrain();
  const thisWeekDates = new Set(weekDates(weekStart(today)));

  let totalPaidToday = 0;
  let totalPaidThisWeek = 0;
  let cashTotal = 0;
  let benefitTotal = 0;

  for (const doc of paidSnap.docs) {
    const data = doc.data();
    const collected = Number(data.paidAmount ?? data.amount) || 0;
    const paymentMethod = data.paymentMethod as PaymentMethod | null;
    const paymentDate = data.paymentDate as Timestamp | null;

    if (paymentMethod === "cash") cashTotal += collected;
    else if (paymentMethod === "benefit") benefitTotal += collected;

    if (paymentDate) {
      const paidDateStr = dateInBahrain(paymentDate.toDate());
      if (paidDateStr === today) totalPaidToday += collected;
      if (thisWeekDates.has(paidDateStr)) totalPaidThisWeek += collected;
    }
  }

  return {
    totalUnpaid,
    totalPaidToday,
    totalPaidThisWeek,
    cashTotal,
    benefitTotal,
    grandTotal: cashTotal + benefitTotal,
  };
}
