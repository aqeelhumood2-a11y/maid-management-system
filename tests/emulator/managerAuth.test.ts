import { initializeApp, getApps, deleteApp, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { changeManagerPasswordServer, verifyManagerPassword } from "@/lib/server/managerAuth";
import { ServiceError } from "@/lib/server/errors";
import type { Actor } from "@/lib/server/bookingService";

/**
 * Exercises the changeable-password storage added for Site Settings →
 * Change Password against the Firestore emulator: verifying the default
 * hardcoded password before any change, changing it, requiring the new
 * password (not the old one) afterward, and manager-only enforcement.
 */

let app: App;
let db: Firestore;

const MANAGER: Actor = { uid: "mgr", email: "", name: "المدير", role: "manager" };
const EMPLOYEE: Actor = { uid: "employee", email: "", name: "موظف", role: "employee" };

const DEFAULT_PASSWORD = "33199666";

beforeAll(() => {
  const existing = getApps().find((a) => a.name === "manager-auth-test-app");
  app = existing ?? initializeApp({ projectId: "demo-maid-mgmt-auth" }, "manager-auth-test-app");
  db = getFirestore(app);
});

afterAll(async () => {
  await deleteApp(app);
});

async function clearCollections() {
  for (const name of ["settings", "activityLogs"]) {
    const snap = await db.collection(name).get();
    await Promise.all(snap.docs.map((d) => d.ref.delete()));
  }
}

describe("verifyManagerPassword — before any change", () => {
  it("accepts the default hardcoded password when no override has ever been saved", async () => {
    await clearCollections();
    expect(await verifyManagerPassword(db, DEFAULT_PASSWORD)).toBe(true);
  });

  it("rejects a wrong password", async () => {
    await clearCollections();
    expect(await verifyManagerPassword(db, "wrong")).toBe(false);
  });
});

describe("changeManagerPasswordServer", () => {
  it("rejects a non-manager actor and writes nothing", async () => {
    await clearCollections();
    await expect(
      changeManagerPasswordServer(db, DEFAULT_PASSWORD, "newpass123", EMPLOYEE)
    ).rejects.toThrow(ServiceError);
    const snap = await db.collection("settings").doc("managerAuth").get();
    expect(snap.exists).toBe(false);
  });

  it("rejects an incorrect current password", async () => {
    await clearCollections();
    await expect(
      changeManagerPasswordServer(db, "wrong-current", "newpass123", MANAGER)
    ).rejects.toMatchObject({ code: "INVALID_PASSWORD" });
  });

  it("rejects a new password shorter than the minimum length", async () => {
    await clearCollections();
    await expect(
      changeManagerPasswordServer(db, DEFAULT_PASSWORD, "abc", MANAGER)
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("changes the password: the new one works, the old default no longer does", async () => {
    await clearCollections();
    await changeManagerPasswordServer(db, DEFAULT_PASSWORD, "newpass123", MANAGER);

    expect(await verifyManagerPassword(db, "newpass123")).toBe(true);
    expect(await verifyManagerPassword(db, DEFAULT_PASSWORD)).toBe(false);
  });

  it("requires the just-changed password (not the original default) for a second change", async () => {
    await clearCollections();
    await changeManagerPasswordServer(db, DEFAULT_PASSWORD, "firstchange", MANAGER);

    await expect(
      changeManagerPasswordServer(db, DEFAULT_PASSWORD, "secondchange", MANAGER)
    ).rejects.toMatchObject({ code: "INVALID_PASSWORD" });

    await changeManagerPasswordServer(db, "firstchange", "secondchange", MANAGER);
    expect(await verifyManagerPassword(db, "secondchange")).toBe(true);
  });

  it("never stores the plaintext password", async () => {
    await clearCollections();
    await changeManagerPasswordServer(db, DEFAULT_PASSWORD, "newpass123", MANAGER);
    const snap = await db.collection("settings").doc("managerAuth").get();
    const data = snap.data() as { salt: string; hash: string };
    expect(data.hash).not.toContain("newpass123");
    expect(typeof data.salt).toBe("string");
    expect(typeof data.hash).toBe("string");
  });

  it("logs a manager_password_changed activity entry without any password material", async () => {
    await clearCollections();
    await changeManagerPasswordServer(db, DEFAULT_PASSWORD, "newpass123", MANAGER);
    const logs = await db.collection("activityLogs").where("type", "==", "manager_password_changed").get();
    expect(logs.size).toBe(1);
    expect(logs.docs[0].data().before).toBeNull();
    expect(logs.docs[0].data().after).toBeNull();
  });
});
