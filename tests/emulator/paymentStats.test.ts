import { initializeApp, getApps, deleteApp, type App } from "firebase-admin/app";
import { getFirestore, Timestamp, type Firestore } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  cancelBookingServer,
  createBookingServer,
  updateBookingPaymentServer,
  updateBookingServer,
  type Actor,
} from "@/lib/server/bookingService";
import {
  createRecurringScheduleServer,
  setRecurringOccurrencePaymentServer,
} from "@/lib/server/recurringService";
import { computePaymentSummary, initializePaymentStatsServer } from "@/lib/server/paymentSummary";
import { ServiceError } from "@/lib/server/errors";
import { addDaysToDateStr, todayBahrain } from "@/lib/date";

/**
 * Proves the payment-stats aggregate stays exactly correct through every
 * payment-affecting transition (mark paid, revert, edit while paid, cancel,
 * recurring materialize+pay), that computePaymentSummary reads only the
 * aggregate + a bounded unpaid query (never re-scanning paid history), and
 * that the one-time initialization path is protected, idempotent, and
 * matches what a full historical scan would have produced.
 */

let app: App;
let db: Firestore;

const MANAGER: Actor = { uid: "mgr", email: "mgr@example.com", name: "المدير", role: "manager" };
const EMPLOYEE: Actor = { uid: "emp", email: "emp@example.com", name: "الموظفة", role: "employee" };

const WEEKDAY_DATE = "2026-07-22"; // Wednesday

beforeAll(() => {
  const existing = getApps().find((a) => a.name === "payment-stats-test-app");
  app = existing ?? initializeApp({ projectId: "demo-maid-mgmt-payment-stats" }, "payment-stats-test-app");
  db = getFirestore(app);
});

afterAll(async () => {
  await deleteApp(app);
});

async function clearCollections() {
  for (const name of ["bookings", "slots", "recurringSchedules", "recurringExceptions", "activityLogs", "settings"]) {
    const snap = await db.collection(name).get();
    await Promise.all(snap.docs.map((d) => d.ref.delete()));
  }
}

const BASE_INPUT = {
  date: WEEKDAY_DATE,
  shift: "morning" as const,
  workerId: "w1",
  workerName: "سارة",
  areaId: "a1",
  areaName: "المنامة",
  hours: 4,
  amount: 12,
  customerName: "أحمد",
  customerPhone: "36000000",
  customerLocation: "قريب من السوق",
  source: "today" as const,
  recurringSeriesId: null,
};

describe("payment stats aggregate — mark paid / revert / edit / cancel", () => {
  it("marking a booking paid (cash) increments cashTotal, dailyPaid[today], and unpaid excludes it", async () => {
    await clearCollections();
    const id = await createBookingServer(db, BASE_INPUT, MANAGER);

    await updateBookingPaymentServer(db, id, { isPaid: true, paymentMethod: "cash", paidAmount: 12 }, MANAGER);

    const summary = await computePaymentSummary(db);
    expect(summary.cashTotal).toBe(12);
    expect(summary.benefitTotal).toBe(0);
    expect(summary.grandTotal).toBe(12);
    expect(summary.totalPaidToday).toBe(12);
    expect(summary.totalPaidThisWeek).toBe(12);
    expect(summary.totalUnpaid).toBe(0);
  });

  it("marking a booking paid (benefit) increments benefitTotal, not cashTotal", async () => {
    await clearCollections();
    const id = await createBookingServer(db, BASE_INPUT, MANAGER);
    await updateBookingPaymentServer(db, id, { isPaid: true, paymentMethod: "benefit", paidAmount: 7 }, MANAGER);

    const summary = await computePaymentSummary(db);
    expect(summary.benefitTotal).toBe(7);
    expect(summary.cashTotal).toBe(0);
  });

  it("an unpaid booking counts toward totalUnpaid and nothing else", async () => {
    await clearCollections();
    await createBookingServer(db, BASE_INPUT, MANAGER);

    const summary = await computePaymentSummary(db);
    expect(summary.totalUnpaid).toBe(12);
    expect(summary.cashTotal).toBe(0);
    expect(summary.benefitTotal).toBe(0);
    expect(summary.totalPaidToday).toBe(0);
  });

  it("reverting a payment removes it from cashTotal and from the day it was originally paid on", async () => {
    await clearCollections();
    const id = await createBookingServer(db, BASE_INPUT, MANAGER);
    await updateBookingPaymentServer(db, id, { isPaid: true, paymentMethod: "cash", paidAmount: 12 }, MANAGER);
    await updateBookingPaymentServer(db, id, { isPaid: false, paymentMethod: null, paidAmount: null }, MANAGER);

    const summary = await computePaymentSummary(db);
    expect(summary.cashTotal).toBe(0);
    expect(summary.totalPaidToday).toBe(0);
    expect(summary.totalUnpaid).toBe(12); // back to unpaid
  });

  it("editing the payment method while paid moves the amount from the old bucket to the new one", async () => {
    await clearCollections();
    const id = await createBookingServer(db, BASE_INPUT, MANAGER);
    await updateBookingPaymentServer(db, id, { isPaid: true, paymentMethod: "cash", paidAmount: 12 }, MANAGER);
    await updateBookingPaymentServer(db, id, { isPaid: true, paymentMethod: "benefit", paidAmount: 12 }, MANAGER);

    const summary = await computePaymentSummary(db);
    expect(summary.cashTotal).toBe(0);
    expect(summary.benefitTotal).toBe(12);
    expect(summary.grandTotal).toBe(12);
  });

  it("editing the paid amount while paid adjusts the total by the delta, not the full new amount", async () => {
    await clearCollections();
    const id = await createBookingServer(db, BASE_INPUT, MANAGER);
    await updateBookingPaymentServer(db, id, { isPaid: true, paymentMethod: "cash", paidAmount: 12 }, MANAGER);
    await updateBookingPaymentServer(db, id, { isPaid: true, paymentMethod: "cash", paidAmount: 20 }, MANAGER);

    const summary = await computePaymentSummary(db);
    expect(summary.cashTotal).toBe(20);
  });

  it("cancelling a paid active booking removes its amount from the aggregate entirely", async () => {
    await clearCollections();
    const id = await createBookingServer(db, BASE_INPUT, MANAGER);
    await updateBookingPaymentServer(db, id, { isPaid: true, paymentMethod: "cash", paidAmount: 12 }, MANAGER);

    let summary = await computePaymentSummary(db);
    expect(summary.cashTotal).toBe(12);

    await cancelBookingServer(db, id, { reason: null, cancelScope: "single" }, MANAGER);

    summary = await computePaymentSummary(db);
    expect(summary.cashTotal).toBe(0);
    expect(summary.grandTotal).toBe(0);
    // Cancelled bookings are gone from the unpaid bucket too — they're not active.
    expect(summary.totalUnpaid).toBe(0);
  });

  it("cancelling an unpaid booking does not touch the aggregate at all", async () => {
    await clearCollections();
    const id = await createBookingServer(db, BASE_INPUT, MANAGER);
    await cancelBookingServer(db, id, { reason: null, cancelScope: "single" }, MANAGER);

    const summary = await computePaymentSummary(db);
    expect(summary.cashTotal).toBe(0);
    expect(summary.benefitTotal).toBe(0);
    expect(summary.totalUnpaid).toBe(0);
  });

  it("editing amount on an already-paid booking with a recorded paidAmount does not change the aggregate", async () => {
    await clearCollections();
    const id = await createBookingServer(db, BASE_INPUT, MANAGER);
    await updateBookingPaymentServer(db, id, { isPaid: true, paymentMethod: "cash", paidAmount: 12 }, MANAGER);

    await updateBookingServer(
      db,
      id,
      {
        areaId: BASE_INPUT.areaId,
        areaName: BASE_INPUT.areaName,
        hours: BASE_INPUT.hours,
        amount: 99, // service amount changes; paidAmount (12) already recorded, so collected stays 12
        customerName: BASE_INPUT.customerName,
        customerPhone: BASE_INPUT.customerPhone,
        customerLocation: BASE_INPUT.customerLocation,
      },
      MANAGER
    );

    const summary = await computePaymentSummary(db);
    expect(summary.cashTotal).toBe(12);
  });

  it("multiple paid bookings accumulate correctly across cash and benefit", async () => {
    await clearCollections();
    const id1 = await createBookingServer(db, BASE_INPUT, MANAGER);
    const id2 = await createBookingServer(db, { ...BASE_INPUT, workerId: "w2", workerName: "منى" }, MANAGER);
    await updateBookingPaymentServer(db, id1, { isPaid: true, paymentMethod: "cash", paidAmount: 10 }, MANAGER);
    await updateBookingPaymentServer(db, id2, { isPaid: true, paymentMethod: "benefit", paidAmount: 15 }, MANAGER);

    const summary = await computePaymentSummary(db);
    expect(summary.cashTotal).toBe(10);
    expect(summary.benefitTotal).toBe(15);
    expect(summary.grandTotal).toBe(25);
  });
});

describe("payment stats aggregate — recurring occurrences", () => {
  it("paying a materialized recurring occurrence updates the aggregate the same as a plain booking", async () => {
    await clearCollections();
    const recurringId = await createRecurringScheduleServer(
      db,
      {
        workerId: "w1",
        workerName: "سارة",
        areaId: "a1",
        areaName: "المنامة",
        shift: "morning",
        dayOfWeek: 3,
        hours: 4,
        amount: 12,
        customerName: "",
        customerPhone: "",
        customerLocation: "",
        startDate: "2026-07-01",
      },
      MANAGER
    );
    const scheduleSnap = await db.collection("recurringSchedules").doc(recurringId).get();
    const schedule = { id: recurringId, ...scheduleSnap.data() } as import("@/lib/types").RecurringSchedule;

    await setRecurringOccurrencePaymentServer(
      db,
      { recurring: schedule, date: "2026-08-05", payment: { isPaid: true, paymentMethod: "cash", paidAmount: 12 } },
      MANAGER
    );

    const summary = await computePaymentSummary(db);
    expect(summary.cashTotal).toBe(12);
  });
});

describe("computePaymentSummary — decoupled from bookings collection size", () => {
  it("does not reflect paid bookings written directly, bypassing the service layer (proves no full-collection scan)", async () => {
    await clearCollections();

    // Bypass bookingService entirely — simulates what a full scan WOULD have
    // picked up. If computePaymentSummary still returned a nonzero total
    // here, it would mean it's re-scanning the bookings collection instead
    // of reading the aggregate document.
    for (let i = 0; i < 20; i++) {
      await db
        .collection("bookings")
        .doc(`bypass-${i}`)
        .set({
          ...BASE_INPUT,
          id: `bypass-${i}`,
          paid: true,
          paymentMethod: "cash",
          paidAmount: 100,
          paymentDate: null,
          status: "active",
        });
    }

    const summary = await computePaymentSummary(db);
    expect(summary.cashTotal).toBe(0);
    expect(summary.benefitTotal).toBe(0);
    expect(summary.grandTotal).toBe(0);
  });
});

describe("initializePaymentStatsServer — one-time historical seeding", () => {
  it("rejects a non-manager", async () => {
    await clearCollections();
    await expect(initializePaymentStatsServer(db, EMPLOYEE)).rejects.toThrow(ServiceError);
  });

  it("seeds cashTotal/benefitTotal/dailyPaid from existing paid bookings that predate the aggregate", async () => {
    await clearCollections();

    // Simulate historical data that existed before this feature shipped —
    // written directly, exactly like real production data does, with no
    // paymentStats doc ever having been touched.
    const paymentDate = Timestamp.now();
    await db.collection("bookings").doc("legacy-1").set({
      ...BASE_INPUT,
      paid: true,
      paymentMethod: "cash",
      paidAmount: 30,
      paymentDate,
      status: "active",
    });
    await db.collection("bookings").doc("legacy-2").set({
      ...BASE_INPUT,
      paid: true,
      paymentMethod: "benefit",
      paidAmount: 20,
      paymentDate,
      status: "active",
    });
    await db.collection("bookings").doc("legacy-cancelled").set({
      ...BASE_INPUT,
      paid: true,
      paymentMethod: "cash",
      paidAmount: 999,
      paymentDate,
      status: "cancelled", // must NOT be counted — matches the original active-only scan
    });

    const result = await initializePaymentStatsServer(db, MANAGER);
    expect(result.cashTotal).toBe(30);
    expect(result.benefitTotal).toBe(20);
    expect(result.bookingsScanned).toBe(2);

    const summary = await computePaymentSummary(db);
    expect(summary.cashTotal).toBe(30);
    expect(summary.benefitTotal).toBe(20);
  });

  it("is idempotent — a second call is rejected and does not double the totals", async () => {
    await clearCollections();
    await db.collection("bookings").doc("legacy-1").set({
      ...BASE_INPUT,
      paid: true,
      paymentMethod: "cash",
      paidAmount: 30,
      paymentDate: Timestamp.now(),
      status: "active",
    });

    await initializePaymentStatsServer(db, MANAGER);
    await expect(initializePaymentStatsServer(db, MANAGER)).rejects.toThrow(ServiceError);

    const summary = await computePaymentSummary(db);
    expect(summary.cashTotal).toBe(30); // not 60
  });

  it("incremental updates after initialization add on top of the seeded baseline correctly", async () => {
    await clearCollections();
    await db.collection("bookings").doc("legacy-1").set({
      ...BASE_INPUT,
      paid: true,
      paymentMethod: "cash",
      paidAmount: 30,
      paymentDate: Timestamp.now(),
      status: "active",
    });
    await initializePaymentStatsServer(db, MANAGER);

    const newId = await createBookingServer(db, BASE_INPUT, MANAGER);
    await updateBookingPaymentServer(db, newId, { isPaid: true, paymentMethod: "cash", paidAmount: 5 }, MANAGER);

    const summary = await computePaymentSummary(db);
    expect(summary.cashTotal).toBe(35);
  });
});

describe("totalPaidThisWeek — bucketed by the day payment was recorded", () => {
  it("a payment recorded today counts toward both today and this week", async () => {
    await clearCollections();
    const id = await createBookingServer(db, BASE_INPUT, MANAGER);
    await updateBookingPaymentServer(db, id, { isPaid: true, paymentMethod: "cash", paidAmount: 12 }, MANAGER);

    const summary = await computePaymentSummary(db);
    expect(summary.totalPaidToday).toBe(12);
    expect(summary.totalPaidThisWeek).toBe(12);
  });

  it("a payment recorded outside this week does not count toward totalPaidThisWeek", async () => {
    await clearCollections();
    // Seed a historical payment bucketed to a date guaranteed outside the
    // current week, exactly as initialization would produce for old data.
    const farPast = addDaysToDateStr(todayBahrain(), -60);
    await db.collection("bookings").doc("old-paid").set({
      ...BASE_INPUT,
      paid: true,
      paymentMethod: "cash",
      paidAmount: 40,
      paymentDate: Timestamp.fromDate(new Date(`${farPast}T12:00:00Z`)),
      status: "active",
    });
    await initializePaymentStatsServer(db, MANAGER);

    const summary = await computePaymentSummary(db);
    expect(summary.cashTotal).toBe(40); // all-time total still includes it
    expect(summary.totalPaidToday).toBe(0);
    expect(summary.totalPaidThisWeek).toBe(0);
  });
});
