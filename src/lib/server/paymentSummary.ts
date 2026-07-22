import { FieldValue, type Firestore, type Timestamp } from "firebase-admin/firestore";
import { dateInBahrain, todayBahrain, weekDates, weekStart } from "../date";
import { ServiceError } from "./errors";
import type { Actor } from "./bookingService";
import type { PaymentMethod } from "../types";

export interface PaymentSummary {
  totalUnpaid: number;
  totalPaidToday: number;
  totalPaidThisWeek: number;
  cashTotal: number;
  benefitTotal: number;
  grandTotal: number;
}

interface PaymentStatsDoc {
  cashTotal?: number;
  benefitTotal?: number;
  dailyPaid?: Record<string, number>;
  initializedAt?: Timestamp | null;
  updatedAt?: Timestamp;
}

const PAYMENT_STATS_DOC_PATH = ["settings", "paymentStats"] as const;

/**
 * Backs the manager dashboard's Payment Summary card. Unpaid bookings are
 * still read live (bounded — only currently-outstanding bookings, which is
 * the actionable set a manager needs to see) but the all-time paid figures
 * (cashTotal/benefitTotal) and the "paid today"/"paid this week" figures
 * now come from `settings/paymentStats`, a running aggregate kept in sync
 * incrementally by every payment-affecting write (see
 * applyPaymentStatsDelta in bookingService.ts) instead of re-scanning every
 * paid booking ever recorded on every call — that unbounded scan, repeated
 * every poll, is what exhausted the Firestore free-tier daily quota.
 */
export async function computePaymentSummary(db: Firestore): Promise<PaymentSummary> {
  const [unpaidSnap, statsSnap] = await Promise.all([
    db.collection("bookings").where("status", "==", "active").where("paid", "==", false).get(),
    db.collection(PAYMENT_STATS_DOC_PATH[0]).doc(PAYMENT_STATS_DOC_PATH[1]).get(),
  ]);

  const totalUnpaid = unpaidSnap.docs.reduce((sum, d) => sum + (Number(d.data().amount) || 0), 0);

  const stats = (statsSnap.data() as PaymentStatsDoc | undefined) ?? {};
  const cashTotal = stats.cashTotal ?? 0;
  const benefitTotal = stats.benefitTotal ?? 0;
  const dailyPaid = stats.dailyPaid ?? {};

  const today = todayBahrain();
  const totalPaidToday = dailyPaid[today] ?? 0;
  const totalPaidThisWeek = weekDates(weekStart(today)).reduce((sum, d) => sum + (dailyPaid[d] ?? 0), 0);

  return {
    totalUnpaid,
    totalPaidToday,
    totalPaidThisWeek,
    cashTotal,
    benefitTotal,
    grandTotal: cashTotal + benefitTotal,
  };
}

function requireManager(actor: Actor) {
  if (actor.role !== "manager") {
    throw new ServiceError("هذا الإجراء متاح للمدير فقط", "FORBIDDEN", 403);
  }
}

export interface PaymentStatsInitResult {
  cashTotal: number;
  benefitTotal: number;
  bookingsScanned: number;
}

/**
 * One-time, explicit, manager-only seeding of `settings/paymentStats` from
 * existing historical data — the only place in this whole fix that performs
 * a full scan of the paid-bookings history, and it does so exactly once,
 * ever, by design. Every future payment change updates the aggregate
 * incrementally instead (see applyPaymentStatsDelta), so this cost is never
 * paid again.
 *
 * Idempotent and safe to call more than once: if `initializedAt` is already
 * set, it refuses outright rather than re-summing and doubling the totals.
 * Never runs automatically — no deploy hook, no page load, no cron; it only
 * runs when a manager explicitly calls POST /api/manager/payment-stats/initialize.
 */
export async function initializePaymentStatsServer(db: Firestore, actor: Actor): Promise<PaymentStatsInitResult> {
  requireManager(actor);
  const ref = db.collection(PAYMENT_STATS_DOC_PATH[0]).doc(PAYMENT_STATS_DOC_PATH[1]);

  // Fail fast before paying for the scan below if it's obviously already done.
  const precheck = await ref.get();
  if ((precheck.data() as PaymentStatsDoc | undefined)?.initializedAt) {
    throw new ServiceError(
      "تم تهيئة إحصائيات المدفوعات مسبقاً — لا يمكن تكرار هذا الإجراء",
      "ALREADY_INITIALIZED",
      409
    );
  }

  // The one deliberate full-history read in this entire fix — see the
  // function doc comment above for why this is safe and necessary. Kept
  // outside the transaction below: a very large history could otherwise
  // make the transaction slow enough to risk Firestore's transaction time
  // limit, for no benefit — only the final check-then-write needs to be
  // atomic, not the scan that feeds it.
  const paidSnap = await db.collection("bookings").where("status", "==", "active").where("paid", "==", true).get();

  let cashTotal = 0;
  let benefitTotal = 0;
  const dailyPaid: Record<string, number> = {};

  for (const doc of paidSnap.docs) {
    const data = doc.data();
    const collected = Number(data.paidAmount ?? data.amount) || 0;
    const paymentMethod = data.paymentMethod as PaymentMethod | null;
    const paymentDate = data.paymentDate as Timestamp | null;

    if (paymentMethod === "cash") cashTotal += collected;
    else if (paymentMethod === "benefit") benefitTotal += collected;

    if (paymentDate) {
      const dayKey = dateInBahrain(paymentDate.toDate());
      dailyPaid[dayKey] = (dailyPaid[dayKey] ?? 0) + collected;
    }
  }

  // Re-check-and-write atomically so two concurrent init calls can never
  // both pass the precheck and double-count the totals.
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if ((snap.data() as PaymentStatsDoc | undefined)?.initializedAt) {
      throw new ServiceError(
        "تم تهيئة إحصائيات المدفوعات مسبقاً — لا يمكن تكرار هذا الإجراء",
        "ALREADY_INITIALIZED",
        409
      );
    }
    tx.set(ref, {
      cashTotal,
      benefitTotal,
      dailyPaid,
      initializedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    const logRef = db.collection("activityLogs").doc();
    tx.set(logRef, {
      type: "payment_stats_initialized",
      entityType: "paymentStats",
      entityId: "paymentStats",
      actingUid: actor.uid,
      actingEmail: actor.email,
      actingName: actor.name,
      before: null,
      after: { cashTotal, benefitTotal, bookingsScanned: paidSnap.size },
      createdAt: FieldValue.serverTimestamp(),
    });
  });

  return { cashTotal, benefitTotal, bookingsScanned: paidSnap.size };
}
