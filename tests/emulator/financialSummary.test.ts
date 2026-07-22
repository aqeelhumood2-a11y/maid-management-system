import { initializeApp, getApps, deleteApp, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createBookingServer, ServiceError, updateBookingPaymentServer, type Actor } from "@/lib/server/bookingService";
import { getFinancialSummaryServer } from "@/lib/server/financialSummary";
import { addDaysToDateStr, todayBahrain } from "@/lib/date";

/**
 * Exercises the Manager Financial Settlement server layer
 * (getFinancialSummaryServer) against the Firestore emulator: manager-only
 * enforcement, the completed+paid filter (excluding future-dated and
 * cancelled bookings), and the activity log entry it writes for every
 * calculation (requirement #9).
 */

let app: App;
let db: Firestore;

const MANAGER: Actor = { uid: "mgr", email: "mgr@example.com", name: "المدير", role: "manager" };
const EMPLOYEE: Actor = { uid: "emp", email: "emp@example.com", name: "الموظفة", role: "employee" };

beforeAll(() => {
  const existing = getApps().find((a) => a.name === "fin-test-app");
  app = existing ?? initializeApp({ projectId: "demo-maid-mgmt-fin" }, "fin-test-app");
  db = getFirestore(app);
});

afterAll(async () => {
  await deleteApp(app);
});

async function clearCollections() {
  for (const name of ["bookings", "slots", "activityLogs"]) {
    const snap = await db.collection(name).get();
    await Promise.all(snap.docs.map((d) => d.ref.delete()));
  }
}

const today = todayBahrain();
const yesterday = addDaysToDateStr(today, -1);
const future = addDaysToDateStr(today, 5);

const BASE_INPUT = {
  shift: "morning" as const,
  workerId: "w1",
  workerName: "سارة",
  areaId: "a1",
  areaName: "المنامة",
  hours: 4,
  amount: 10,
  customerName: "",
  customerPhone: "",
  customerLocation: "",
  source: "today" as const,
  recurringSeriesId: null,
};

async function createPaidBooking(date: string, workerId = "w1", workerName = "سارة", amount = 10) {
  const id = await createBookingServer(
    db,
    { ...BASE_INPUT, date, workerId, workerName, amount },
    MANAGER
  );
  await updateBookingPaymentServer(db, id, { isPaid: true, paymentMethod: "cash", paidAmount: amount }, MANAGER);
  return id;
}

describe("getFinancialSummaryServer — Manager Financial Settlement", () => {
  it("rejects a non-manager", async () => {
    await clearCollections();
    await expect(getFinancialSummaryServer(db, yesterday, today, EMPLOYEE)).rejects.toThrow(ServiceError);
  });

  it("includes only completed (date <= today) AND paid bookings in earnings", async () => {
    await clearCollections();
    await createPaidBooking(yesterday, "w1", "سارة", 10); // completed + paid
    // Same worker/date, different shift so it doesn't conflict with the slot above.
    await createBookingServer(db, { ...BASE_INPUT, date: yesterday, shift: "afternoon", workerId: "w1" }, MANAGER); // completed, unpaid
    await createPaidBooking(future, "w1", "سارة", 10); // paid, but not completed yet

    const summary = await getFinancialSummaryServer(db, yesterday, future, MANAGER);
    expect(summary.workers).toHaveLength(1);
    const w = summary.workers[0];
    // 2 completed bookings that day (1 paid + 1 unpaid), only the paid one earns
    expect(w.totalCompletedBookings).toBe(2);
    expect(w.totalPaidBookings).toBe(1);
    expect(w.totalEarnings).toBe(3);
  });

  it("computes workersTotal, overallTotal and managerNet correctly", async () => {
    await clearCollections();
    await createPaidBooking(yesterday, "w1", "سارة", 12);
    await createPaidBooking(yesterday, "w2", "منى", 8);

    const summary = await getFinancialSummaryServer(db, yesterday, today, MANAGER);
    expect(summary.workersTotal).toBe(6); // 3 + 3 (one booking each that day)
    expect(summary.overallTotal).toBe(20); // 12 + 8
    expect(summary.managerNet).toBe(14); // 20 - 6
  });

  it("existing bookings paid before this feature existed are included automatically (no migration)", async () => {
    await clearCollections();
    // Simulate a booking paid before `paidAmount` existed as a field.
    const ref = db.collection("bookings").doc();
    await ref.set({
      date: yesterday,
      shift: "morning",
      workerId: "w1",
      workerName: "سارة",
      areaId: "a1",
      areaName: "المنامة",
      hours: 4,
      amount: 9,
      paymentMethod: "cash",
      paid: true,
      // paidAmount intentionally omitted, like legacy data
      paymentDate: null,
      paymentBy: "manager",
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
    });

    const summary = await getFinancialSummaryServer(db, yesterday, today, MANAGER);
    expect(summary.overallTotal).toBe(9); // falls back to `amount`
    expect(summary.workersTotal).toBe(3);
  });

  it("logs a settlement_calculated activity entry for every calculation", async () => {
    await clearCollections();
    await createPaidBooking(yesterday);

    await getFinancialSummaryServer(db, yesterday, today, MANAGER);

    const logsSnap = await db.collection("activityLogs").where("type", "==", "settlement_calculated").get();
    expect(logsSnap.size).toBe(1);
    expect(logsSnap.docs[0].data().after).toMatchObject({
      rangeStart: yesterday,
      rangeEnd: today,
      workersTotal: 3,
    });
  });

  it("excludes cancelled bookings from both completed counts and earnings", async () => {
    await clearCollections();
    const id = await createPaidBooking(yesterday);
    await db.collection("bookings").doc(id).update({ status: "cancelled" });

    const summary = await getFinancialSummaryServer(db, yesterday, today, MANAGER);
    expect(summary.workers).toHaveLength(0);
    expect(summary.overallTotal).toBe(0);
  });
});
