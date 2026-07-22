import { initializeApp, getApps, deleteApp, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildPaymentsQuery, PAID_HISTORY_LIMIT } from "@/app/api/bookings/payments/route";

/**
 * /manager/unpaid's "paid"/"all"/"cash"/"benefit" filters used to scan the
 * entire paid-booking history on every 20s poll — exactly the kind of
 * unbounded read that exhausted the Firestore quota. Proves the query these
 * filters now use is capped, while the default "unpaid" filter (the
 * actionable, inherently-small set) stays unbounded on purpose.
 */

let app: App;
let db: Firestore;

beforeAll(() => {
  const existing = getApps().find((a) => a.name === "payments-query-test-app");
  app = existing ?? initializeApp({ projectId: "demo-maid-mgmt-payments-query" }, "payments-query-test-app");
  db = getFirestore(app);
});

afterAll(async () => {
  await deleteApp(app);
});

async function clearBookings() {
  const snap = await db.collection("bookings").get();
  await Promise.all(snap.docs.map((d) => d.ref.delete()));
}

/** Writes N paid bookings directly (bypassing the service layer) via batched writes — fast, and the point here is query shape, not the write path. */
async function seedPaidBookings(count: number, overrides: Record<string, unknown> = {}) {
  const chunks: number[][] = [];
  for (let i = 0; i < count; i += 400) {
    chunks.push(Array.from({ length: Math.min(400, count - i) }, (_, j) => i + j));
  }
  for (const chunk of chunks) {
    const batch = db.batch();
    for (const i of chunk) {
      const ref = db.collection("bookings").doc(`paid-${i}`);
      batch.set(ref, {
        date: `2026-01-${String((i % 28) + 1).padStart(2, "0")}`,
        shift: "morning",
        workerId: "w1",
        workerName: "سارة",
        areaId: "a1",
        areaName: "المنامة",
        hours: 4,
        amount: 10,
        paymentMethod: "cash",
        paid: true,
        paidAmount: 10,
        paymentDate: null,
        paymentBy: "manager",
        customerName: "",
        customerPhone: "",
        customerLocation: "",
        source: "today",
        recurringSeriesId: null,
        status: "active",
        cancelledAt: null,
        cancelledBy: null,
        cancelledReason: null,
        cancelScope: null,
        createdBy: "manager",
        createdAt: null,
        updatedBy: "manager",
        updatedAt: null,
        ...overrides,
      });
    }
    await batch.commit();
  }
}

describe("buildPaymentsQuery — bounded reads for paid-history filters", () => {
  it("caps the 'paid' filter at PAID_HISTORY_LIMIT even when far more paid bookings exist", async () => {
    await clearBookings();
    const total = PAID_HISTORY_LIMIT + 25;
    await seedPaidBookings(total);

    const snap = await buildPaymentsQuery(db, "paid").get();
    expect(snap.size).toBe(PAID_HISTORY_LIMIT);
    expect(snap.size).toBeLessThan(total);
  }, 30000);

  it("caps the 'all' filter at PAID_HISTORY_LIMIT the same way", async () => {
    await clearBookings();
    await seedPaidBookings(PAID_HISTORY_LIMIT + 10);

    const snap = await buildPaymentsQuery(db, "all").get();
    expect(snap.size).toBe(PAID_HISTORY_LIMIT);
  }, 30000);

  it("caps the 'cash'/'benefit' filters at PAID_HISTORY_LIMIT", async () => {
    await clearBookings();
    await seedPaidBookings(PAID_HISTORY_LIMIT + 10, { paymentMethod: "cash" });

    const snap = await buildPaymentsQuery(db, "cash").get();
    expect(snap.size).toBe(PAID_HISTORY_LIMIT);
  }, 30000);

  it("does NOT cap the 'unpaid' filter — the outstanding set is read in full", async () => {
    await clearBookings();
    const total = 30;
    await seedPaidBookings(total, { paid: false, paymentMethod: null, paidAmount: null });

    const snap = await buildPaymentsQuery(db, "unpaid").get();
    expect(snap.size).toBe(total); // well under PAID_HISTORY_LIMIT, and nothing was truncated
  });
});
