import { initializeApp, getApps, deleteApp, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createBookingServer, type Actor } from "@/lib/server/bookingService";
import {
  createWorkerServer,
  deleteWorkerServer,
  getWorkerFutureCommitmentsServer,
} from "@/lib/server/catalogService";
import { ServiceError } from "@/lib/server/errors";
import { addDaysToDateStr, todayBahrain } from "@/lib/date";

/**
 * Covers the manager "حذف العاملة" (delete worker) feature: a PERMANENT
 * deletion of the worker document (no soft-delete/active flag involved)
 * that must never touch historical bookings/recurring schedules — which
 * already carry their own denormalized `workerName` — must warn when the
 * worker has future commitments, and must exclude the worker from every
 * future selection list simply by no longer existing in the `workers`
 * collection. Exercises the same trusted server layer the
 * /api/workers/[id] (DELETE) and /api/workers/[id]/impact routes call.
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

describe("worker deletion — permanent hard delete", () => {
  it("permanently deletes a worker document with no linked records", async () => {
    await clearCollections();
    const id = await createWorkerServer(db, { name: "منى", phone: "36011111" }, MANAGER);

    await deleteWorkerServer(db, id, MANAGER);

    const snap = await db.collection("workers").doc(id).get();
    expect(snap.exists).toBe(false);
  });

  it("logs worker_deleted with worker id/name/actor/timestamp, and the log survives the document's deletion", async () => {
    await clearCollections();
    const id = await createWorkerServer(db, { name: "هالة", phone: "36033333" }, MANAGER);

    await deleteWorkerServer(db, id, MANAGER);

    const logs = await db
      .collection("activityLogs")
      .where("entityId", "==", id)
      .where("type", "==", "worker_deleted")
      .get();
    expect(logs.size).toBe(1);
    const log = logs.docs[0].data();
    expect(log.entityId).toBe(id);
    expect(log.entityType).toBe("worker");
    expect(log.actingUid).toBe(MANAGER.uid);
    expect(log.actingName).toBe(MANAGER.name);
    expect(log.before).toMatchObject({ name: "هالة" });
    expect(log.after).toBeNull();
    expect(log.createdAt).toBeTruthy();

    const workerSnap = await db.collection("workers").doc(id).get();
    expect(workerSnap.exists).toBe(false);
  });

  it("rejects an employee from permanently deleting a worker, leaving the document intact", async () => {
    await clearCollections();
    const id = await createWorkerServer(db, { name: "هدى", phone: "" }, MANAGER);
    await expect(deleteWorkerServer(db, id, EMPLOYEE)).rejects.toThrow(ServiceError);
    const snap = await db.collection("workers").doc(id).get();
    expect(snap.exists).toBe(true);
  });

  it("fails with NOT_FOUND when deleting a worker id that does not exist (e.g. already deleted)", async () => {
    await clearCollections();
    await expect(deleteWorkerServer(db, "no-such-worker", MANAGER)).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404,
    });
  });
});

describe("worker deletion — preserves historical records and worker name", () => {
  it("permanently deleting a worker leaves an existing past booking's workerId/workerName/status unchanged", async () => {
    await clearCollections();
    const id = await createWorkerServer(db, { name: "زهرة", phone: "36022222" }, MANAGER);
    const bookingId = await createBookingServer(db, bookingInput(id, "زهرة", PAST_DATE), MANAGER);

    await deleteWorkerServer(db, id, MANAGER);

    const bookingSnap = await db.collection("bookings").doc(bookingId).get();
    const booking = bookingSnap.data()!;
    expect(booking.workerId).toBe(id);
    expect(booking.workerName).toBe("زهرة");
    expect(booking.status).toBe("active");
    expect(booking.date).toBe(PAST_DATE);

    const workerSnap = await db.collection("workers").doc(id).get();
    expect(workerSnap.exists).toBe(false);
  });

  it("preserves the saved worker name inside a recurring schedule after the worker is permanently deleted", async () => {
    await clearCollections();
    const id = await createWorkerServer(db, { name: "سحر", phone: "" }, MANAGER);
    const recurringRef = db.collection("recurringSchedules").doc();
    await recurringRef.set({ workerId: id, workerName: "سحر", status: "active", shift: "morning", dayOfWeek: 3 });

    await deleteWorkerServer(db, id, MANAGER);

    const recurringSnap = await recurringRef.get();
    expect(recurringSnap.data()?.workerName).toBe("سحر");
    expect(recurringSnap.data()?.workerId).toBe(id);
  });
});

describe("getWorkerFutureCommitmentsServer — warning before permanent deletion", () => {
  it("reports zero commitments for a worker with no bookings or recurring schedules", async () => {
    await clearCollections();
    const id = await createWorkerServer(db, { name: "سلمى", phone: "" }, MANAGER);
    const result = await getWorkerFutureCommitmentsServer(db, id, todayBahrain(), MANAGER);
    expect(result).toEqual({ futureBookings: 0, activeRecurringSchedules: 0 });
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

  it("still reports future commitments right up until the worker is actually deleted, proving the warning reflects real data", async () => {
    await clearCollections();
    const id = await createWorkerServer(db, { name: "وفاء", phone: "" }, MANAGER);
    await createBookingServer(db, bookingInput(id, "وفاء", FUTURE_DATE), MANAGER);
    const before = await getWorkerFutureCommitmentsServer(db, id, todayBahrain(), MANAGER);
    expect(before.futureBookings).toBe(1);

    await deleteWorkerServer(db, id, MANAGER);

    // The future booking itself still exists (never auto-deleted) even though the worker is gone.
    const bookingsSnap = await db.collection("bookings").where("workerId", "==", id).get();
    expect(bookingsSnap.size).toBe(1);
    expect(bookingsSnap.docs[0].data().workerName).toBe("وفاء");
  });
});

describe("worker deletion — excluded from every selection list", () => {
  it("no longer appears in the workers collection listing after permanent deletion, while other workers remain", async () => {
    await clearCollections();
    const keepId = await createWorkerServer(db, { name: "تبقى", phone: "" }, MANAGER);
    const deleteId = await createWorkerServer(db, { name: "تُحذف", phone: "" }, MANAGER);

    await deleteWorkerServer(db, deleteId, MANAGER);

    const snap = await db.collection("workers").get();
    const ids = snap.docs.map((d) => d.id);
    expect(ids).toContain(keepId);
    expect(ids).not.toContain(deleteId);
  });
});

describe("worker deletion — old records remain safely readable", () => {
  it("a booking tied to a permanently deleted worker still loads with a usable workerName and no missing required fields", async () => {
    await clearCollections();
    const id = await createWorkerServer(db, { name: "هناء", phone: "36044444" }, MANAGER);
    const bookingId = await createBookingServer(db, bookingInput(id, "هناء", PAST_DATE), MANAGER);

    await deleteWorkerServer(db, id, MANAGER);

    const bookingSnap = await db.collection("bookings").doc(bookingId).get();
    expect(bookingSnap.exists).toBe(true);
    const booking = bookingSnap.data()!;
    expect(typeof booking.workerName).toBe("string");
    expect(booking.workerName.length).toBeGreaterThan(0);
    expect(booking.date).toBe(PAST_DATE);
    expect(booking.shift).toBe("morning");
    expect(booking.status).toBe("active");
  });
});
