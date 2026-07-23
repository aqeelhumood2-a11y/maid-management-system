import { initializeApp, getApps, deleteApp, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createBookingServer, type Actor } from "@/lib/server/bookingService";
import {
  createWorkerServer,
  getWorkerFutureCommitmentsServer,
  updateWorkerServer,
} from "@/lib/server/catalogService";
import { ServiceError } from "@/lib/server/errors";
import { resolveCell, isEligibleForBooking } from "@/lib/availability";
import { addDaysToDateStr, todayBahrain } from "@/lib/date";
import type { Worker } from "@/lib/types";

/**
 * Covers the manager "حذف العاملة" (delete worker) feature: a soft
 * deactivation (active=false) that must never touch historical bookings,
 * payments or activity history, must warn when the worker has future
 * commitments, and must exclude the worker from new booking/recurring
 * selection going forward. Exercises the same trusted server layer the
 * /api/workers/[id] and /api/workers/[id]/impact routes call.
 */

let app: App;
let db: Firestore;

const MANAGER: Actor = { uid: "mgr", email: "mgr@example.com", name: "المدير", role: "manager" };
const EMPLOYEE: Actor = { uid: "emp", email: "emp@example.com", name: "الموظفة", role: "employee" };

beforeAll(() => {
  const existing = getApps().find((a) => a.name === "worker-deletion-test-app");
  app = existing ?? initializeApp({ projectId: "demo-maid-mgmt-worker-deletion" }, "worker-deletion-test-app");
  db = getFirestore(app);
});

afterAll(async () => {
  await deleteApp(app);
});

async function clearCollections() {
  for (const name of ["workers", "bookings", "slots", "recurringSchedules", "activityLogs"]) {
    const snap = await db.collection(name).get();
    await Promise.all(snap.docs.map((d) => d.ref.delete()));
  }
}

const PAST_DATE = addDaysToDateStr(todayBahrain(), -10);
const FUTURE_DATE = addDaysToDateStr(todayBahrain(), 10);

function bookingInput(workerId: string, workerName: string, date: string) {
  return {
    date,
    shift: "morning" as const,
    workerId,
    workerName,
    areaId: "a1",
    areaName: "المنامة",
    hours: 4,
    amount: 12,
    customerName: "أحمد",
    customerPhone: "36000000",
    customerLocation: "قريب من السوق",
    source: "manager_future" as const,
    recurringSeriesId: null,
  };
}

describe("worker deletion (soft-deactivate) — no linked records", () => {
  it("deactivates a worker with no linked records and logs worker_deactivated with id/name/actor/timestamp", async () => {
    await clearCollections();
    const id = await createWorkerServer(db, { name: "منى", phone: "36011111" }, MANAGER);

    await updateWorkerServer(db, id, { active: false }, MANAGER);

    const snap = await db.collection("workers").doc(id).get();
    expect(snap.data()?.active).toBe(false);

    const logs = await db
      .collection("activityLogs")
      .where("entityId", "==", id)
      .where("type", "==", "worker_deactivated")
      .get();
    expect(logs.size).toBe(1);
    const log = logs.docs[0].data();
    expect(log.entityId).toBe(id);
    expect(log.entityType).toBe("worker");
    expect(log.actingUid).toBe(MANAGER.uid);
    expect(log.actingName).toBe(MANAGER.name);
    expect(log.after).toMatchObject({ name: "منى", active: false });
    expect(log.createdAt).toBeTruthy();
  });

  it("rejects an employee from deactivating a worker, leaving it active", async () => {
    await clearCollections();
    const id = await createWorkerServer(db, { name: "هدى", phone: "" }, MANAGER);
    await expect(updateWorkerServer(db, id, { active: false }, EMPLOYEE)).rejects.toThrow(ServiceError);
    const snap = await db.collection("workers").doc(id).get();
    expect(snap.data()?.active).toBe(true);
  });

  it("fails with NOT_FOUND when deactivating a worker id that does not exist", async () => {
    await clearCollections();
    await expect(updateWorkerServer(db, "no-such-worker", { active: false }, MANAGER)).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404,
    });
  });
});

describe("worker deletion — preserves historical records", () => {
  it("deactivating a worker leaves an existing past booking's workerId/workerName and status unchanged", async () => {
    await clearCollections();
    const id = await createWorkerServer(db, { name: "زهرة", phone: "36022222" }, MANAGER);
    const bookingId = await createBookingServer(db, bookingInput(id, "زهرة", PAST_DATE), MANAGER);

    await updateWorkerServer(db, id, { active: false }, MANAGER);

    const bookingSnap = await db.collection("bookings").doc(bookingId).get();
    const booking = bookingSnap.data()!;
    expect(booking.workerId).toBe(id);
    expect(booking.workerName).toBe("زهرة");
    expect(booking.status).toBe("active");
    expect(booking.date).toBe(PAST_DATE);
  });
});

describe("getWorkerFutureCommitmentsServer — warning before deactivation", () => {
  it("reports zero commitments for a worker with no bookings or recurring schedules", async () => {
    await clearCollections();
    const id = await createWorkerServer(db, { name: "سلمى", phone: "" }, MANAGER);
    const result = await getWorkerFutureCommitmentsServer(db, id, todayBahrain(), MANAGER);
    expect(result).toEqual({ futureBookings: 0, activeRecurringSchedules: 0 });
  });

  it("reports zero future bookings when the worker only has past bookings", async () => {
    await clearCollections();
    const id = await createWorkerServer(db, { name: "ريم", phone: "" }, MANAGER);
    await createBookingServer(db, bookingInput(id, "ريم", PAST_DATE), MANAGER);
    const result = await getWorkerFutureCommitmentsServer(db, id, todayBahrain(), MANAGER);
    expect(result.futureBookings).toBe(0);
  });

  it("counts an active booking on or after today as a future commitment", async () => {
    await clearCollections();
    const id = await createWorkerServer(db, { name: "نور", phone: "" }, MANAGER);
    await createBookingServer(db, bookingInput(id, "نور", FUTURE_DATE), MANAGER);
    const result = await getWorkerFutureCommitmentsServer(db, id, todayBahrain(), MANAGER);
    expect(result.futureBookings).toBe(1);
  });

  it("counts only recurring schedules with status active, ignoring ended/cancelled ones", async () => {
    await clearCollections();
    const id = await createWorkerServer(db, { name: "لمى", phone: "" }, MANAGER);
    await db.collection("recurringSchedules").doc().set({
      workerId: id,
      workerName: "لمى",
      status: "active",
      shift: "morning",
      dayOfWeek: 3,
    });
    await db.collection("recurringSchedules").doc().set({
      workerId: id,
      workerName: "لمى",
      status: "ended",
      shift: "morning",
      dayOfWeek: 4,
    });

    const result = await getWorkerFutureCommitmentsServer(db, id, todayBahrain(), MANAGER);
    expect(result.activeRecurringSchedules).toBe(1);
  });

  it("rejects an employee from checking a worker's future commitments", async () => {
    await clearCollections();
    const id = await createWorkerServer(db, { name: "فرح", phone: "" }, MANAGER);
    await expect(getWorkerFutureCommitmentsServer(db, id, todayBahrain(), EMPLOYEE)).rejects.toThrow(ServiceError);
  });
});

describe("worker deletion — excluded from future booking selection", () => {
  it("makes a deactivated worker ineligible for new bookings via resolveCell/isEligibleForBooking", async () => {
    await clearCollections();
    const id = await createWorkerServer(db, { name: "عبير", phone: "" }, MANAGER);

    const beforeSnap = await db.collection("workers").doc(id).get();
    const workerBefore = { id, ...beforeSnap.data() } as Worker;
    expect(isEligibleForBooking(resolveCell(workerBefore, FUTURE_DATE, "morning", [], [], []).status)).toBe(true);

    await updateWorkerServer(db, id, { active: false }, MANAGER);

    const afterSnap = await db.collection("workers").doc(id).get();
    const workerAfter = { id, ...afterSnap.data() } as Worker;
    const resolution = resolveCell(workerAfter, FUTURE_DATE, "morning", [], [], []);
    expect(resolution.status).toBe("inactive");
    expect(isEligibleForBooking(resolution.status)).toBe(false);
  });
});
