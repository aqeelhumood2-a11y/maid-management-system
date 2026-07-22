import { initializeApp, getApps, deleteApp, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getRouteOrderServer, saveRouteOrderServer } from "@/lib/server/routeOrderService";
import { ServiceError } from "@/lib/server/errors";
import type { Actor } from "@/lib/server/bookingService";

let app: App;
let db: Firestore;

const MANAGER: Actor = { uid: "mgr", email: "mgr@example.com", name: "المدير", role: "manager" };
const EMPLOYEE: Actor = { uid: "emp", email: "emp@example.com", name: "الموظفة", role: "employee" };

beforeAll(() => {
  const existing = getApps().find((a) => a.name === "route-order-test-app");
  app = existing ?? initializeApp({ projectId: "demo-maid-mgmt-route-order" }, "route-order-test-app");
  db = getFirestore(app);
});

afterAll(async () => {
  await deleteApp(app);
});

async function clearCollections() {
  for (const name of ["routeOrders", "activityLogs"]) {
    const snap = await db.collection(name).get();
    await Promise.all(snap.docs.map((d) => d.ref.delete()));
  }
}

describe("routeOrderService — Daily Route ordering", () => {
  it("returns an empty order when nothing has been saved yet", async () => {
    await clearCollections();
    const order = await getRouteOrderServer(db, "2026-07-22", "morning");
    expect(order).toEqual([]);
  });

  it("rejects a non-manager from saving an order", async () => {
    await clearCollections();
    await expect(
      saveRouteOrderServer(db, "2026-07-22", "morning", ["w1", "w2"], EMPLOYEE)
    ).rejects.toThrow(ServiceError);
    const order = await getRouteOrderServer(db, "2026-07-22", "morning");
    expect(order).toEqual([]);
  });

  it("lets a manager save and then read back an order", async () => {
    await clearCollections();
    await saveRouteOrderServer(db, "2026-07-22", "morning", ["w2", "w1", "w3"], MANAGER);
    const order = await getRouteOrderServer(db, "2026-07-22", "morning");
    expect(order).toEqual(["w2", "w1", "w3"]);
  });

  it("keeps morning and evening orders completely independent for the same date", async () => {
    await clearCollections();
    await saveRouteOrderServer(db, "2026-07-22", "morning", ["w1", "w2"], MANAGER);
    await saveRouteOrderServer(db, "2026-07-22", "afternoon", ["w2", "w1"], MANAGER);

    const morning = await getRouteOrderServer(db, "2026-07-22", "morning");
    const afternoon = await getRouteOrderServer(db, "2026-07-22", "afternoon");
    expect(morning).toEqual(["w1", "w2"]);
    expect(afternoon).toEqual(["w2", "w1"]);
  });

  it("overwrites a previously saved order for the same date+shift without touching other dates", async () => {
    await clearCollections();
    await saveRouteOrderServer(db, "2026-07-22", "morning", ["w1", "w2"], MANAGER);
    await saveRouteOrderServer(db, "2026-07-23", "morning", ["w3"], MANAGER);
    await saveRouteOrderServer(db, "2026-07-22", "morning", ["w2", "w1"], MANAGER);

    expect(await getRouteOrderServer(db, "2026-07-22", "morning")).toEqual(["w2", "w1"]);
    expect(await getRouteOrderServer(db, "2026-07-23", "morning")).toEqual(["w3"]);
  });

  it("rejects a malformed workerIds array", async () => {
    await clearCollections();
    await expect(
      saveRouteOrderServer(db, "2026-07-22", "morning", ["w1", ""], MANAGER)
    ).rejects.toThrow(ServiceError);
    // @ts-expect-error deliberately malformed to prove server-side validation, not just TS types
    await expect(saveRouteOrderServer(db, "2026-07-22", "morning", ["w1", 5], MANAGER)).rejects.toThrow(
      ServiceError
    );
  });
});
