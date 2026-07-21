import { initializeApp, getApps, deleteApp, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createAreaServer,
  createWorkerServer,
  updateAreaServer,
  updateSettingsServer,
  updateWorkerServer,
} from "@/lib/server/catalogService";
import { ServiceError } from "@/lib/server/errors";
import type { Actor } from "@/lib/server/bookingService";

/**
 * Exercises the trusted server layer for areas/workers/settings (the same
 * functions the API routes under src/app/api/areas, /workers and /settings
 * call), against the Firestore emulator via the Admin SDK — exactly like
 * tests/emulator/transactions.test.ts does for bookings. These used to be
 * written directly from the browser under Firestore Security Rules; now
 * that there is no more Firebase Authentication, this server layer is the
 * only place authorization (manager-only) is enforced.
 */

let app: App;
let db: Firestore;

const MANAGER: Actor = { uid: "mgr", email: "", name: "المدير", role: "manager" };
const EMPLOYEE: Actor = { uid: "employee", email: "", name: "موظف", role: "employee" };

beforeAll(() => {
  const existing = getApps().find((a) => a.name === "catalog-test-app");
  app = existing ?? initializeApp({ projectId: "demo-maid-mgmt-catalog" }, "catalog-test-app");
  db = getFirestore(app);
});

afterAll(async () => {
  await deleteApp(app);
});

async function clearCollections() {
  for (const name of ["areas", "workers", "settings", "activityLogs"]) {
    const snap = await db.collection(name).get();
    await Promise.all(snap.docs.map((d) => d.ref.delete()));
  }
}

describe("areas", () => {
  it("lets a manager create an area", async () => {
    await clearCollections();
    const id = await createAreaServer(db, "المنامة", MANAGER);
    const snap = await db.collection("areas").doc(id).get();
    expect(snap.data()).toMatchObject({ name: "المنامة", active: true, createdBy: MANAGER.uid });
  });

  it("rejects an employee creating an area", async () => {
    await clearCollections();
    await expect(createAreaServer(db, "المنامة", EMPLOYEE)).rejects.toThrow(ServiceError);
    const snap = await db.collection("areas").get();
    expect(snap.size).toBe(0);
  });

  it("rejects an empty name", async () => {
    await clearCollections();
    await expect(createAreaServer(db, "   ", MANAGER)).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("lets a manager deactivate an area and logs the change", async () => {
    await clearCollections();
    const id = await createAreaServer(db, "الرفاع", MANAGER);
    await updateAreaServer(db, id, { active: false }, MANAGER);
    const snap = await db.collection("areas").doc(id).get();
    expect(snap.data()?.active).toBe(false);

    const logs = await db.collection("activityLogs").where("entityId", "==", id).get();
    expect(logs.docs.some((d) => d.data().type === "area_deactivated")).toBe(true);
  });

  it("rejects an employee updating an area", async () => {
    await clearCollections();
    const id = await createAreaServer(db, "سترة", MANAGER);
    await expect(updateAreaServer(db, id, { name: "سترة الجديدة" }, EMPLOYEE)).rejects.toThrow(ServiceError);
  });
});

describe("workers", () => {
  it("lets a manager create a worker", async () => {
    await clearCollections();
    const id = await createWorkerServer(db, { name: "سارة", phone: "36000000" }, MANAGER);
    const snap = await db.collection("workers").doc(id).get();
    expect(snap.data()).toMatchObject({ name: "سارة", phone: "36000000", active: true });
  });

  it("rejects an employee creating a worker", async () => {
    await clearCollections();
    await expect(createWorkerServer(db, { name: "سارة", phone: "" }, EMPLOYEE)).rejects.toThrow(ServiceError);
  });

  it("lets a manager reactivate a worker and logs it as worker_activated", async () => {
    await clearCollections();
    const id = await createWorkerServer(db, { name: "فاطمة", phone: "" }, MANAGER);
    await updateWorkerServer(db, id, { active: false }, MANAGER);
    await updateWorkerServer(db, id, { active: true }, MANAGER);
    const snap = await db.collection("workers").doc(id).get();
    expect(snap.data()?.active).toBe(true);

    const logs = await db
      .collection("activityLogs")
      .where("entityId", "==", id)
      .where("type", "==", "worker_activated")
      .get();
    expect(logs.size).toBe(1);
  });
});

describe("settings", () => {
  it("lets a manager update the business name, keeping the fixed Bahrain timezone", async () => {
    await clearCollections();
    await updateSettingsServer(db, "اسم جديد", MANAGER);
    const snap = await db.collection("settings").doc("app").get();
    expect(snap.data()).toMatchObject({ businessName: "اسم جديد", timezone: "Asia/Bahrain" });
  });

  it("rejects an employee updating settings", async () => {
    await clearCollections();
    await expect(updateSettingsServer(db, "اسم جديد", EMPLOYEE)).rejects.toThrow(ServiceError);
  });
});
