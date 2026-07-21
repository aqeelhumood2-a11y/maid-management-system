import { deleteApp, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ServiceError } from "@/lib/server/errors";
import {
  completeFirstManagerSetup,
  FIRST_MANAGER_EMAIL,
  FIRST_MANAGER_NAME,
  isFirstManagerSetupLocked,
} from "@/lib/server/setupService";

/**
 * Exercises the trusted server layer for the one-time web-based
 * first-manager bootstrap (src/lib/server/setupService.ts), the same code
 * the POST /api/setup-first-manager route calls. Uses a real Admin Auth
 * instance against the Auth emulator (not the rules-unit-testing fake
 * auth context, which never touches the Auth emulator's user store) so
 * createUser/getUserByEmail/setCustomUserClaims are exercised for real.
 */

let app: App;
let db: Firestore;
let auth: Auth;

const STRONG_SECRET = "a-very-strong-one-time-secret-1234567890";
const VALID_PASSWORD = "Str0ngPassw0rd!";

beforeAll(() => {
  const existing = getApps().find((a) => a.name === "setup-test-app");
  app = existing ?? initializeApp({ projectId: "demo-maid-mgmt-setup" }, "setup-test-app");
  db = getFirestore(app);
  auth = getAuth(app);
  process.env.FIRST_MANAGER_SETUP_SECRET = STRONG_SECRET;
});

afterAll(async () => {
  delete process.env.FIRST_MANAGER_SETUP_SECRET;
  await deleteApp(app);
});

async function clearFirestoreState() {
  for (const name of ["users", "settings", "activityLogs"]) {
    const snap = await db.collection(name).get();
    await Promise.all(snap.docs.map((d) => d.ref.delete()));
  }
}

async function clearAuthUser() {
  try {
    const existing = await auth.getUserByEmail(FIRST_MANAGER_EMAIL);
    await auth.deleteUser(existing.uid);
  } catch {
    // no existing user — fine
  }
}

async function seedActiveManager(uid: string) {
  await db.collection("users").doc(uid).set({
    email: `${uid}@example.com`,
    name: uid,
    role: "manager",
    active: true,
    createdAt: new Date(),
    createdBy: "seed",
    updatedAt: new Date(),
    updatedBy: "seed",
  });
}

beforeEach(async () => {
  await clearFirestoreState();
  await clearAuthUser();
});

afterEach(async () => {
  await clearFirestoreState();
  await clearAuthUser();
});

describe("isFirstManagerSetupLocked", () => {
  it("is unlocked when no setup state exists and no active manager exists", async () => {
    expect(await isFirstManagerSetupLocked(db)).toBe(false);
  });

  it("is locked once an active manager exists, even without ever running setup", async () => {
    await seedActiveManager("some-manager");
    expect(await isFirstManagerSetupLocked(db)).toBe(true);
  });
});

describe("completeFirstManagerSetup — validation", () => {
  it("rejects an incorrect setup secret and creates nothing", async () => {
    await expect(
      completeFirstManagerSetup(db, auth, { secret: "wrong-secret", password: VALID_PASSWORD })
    ).rejects.toMatchObject({ code: "INVALID_SECRET" });

    expect(await isFirstManagerSetupLocked(db)).toBe(false);
    await expect(auth.getUserByEmail(FIRST_MANAGER_EMAIL)).rejects.toBeTruthy();
  });

  it("rejects a password shorter than the minimum and creates nothing", async () => {
    await expect(
      completeFirstManagerSetup(db, auth, { secret: STRONG_SECRET, password: "short" })
    ).rejects.toMatchObject({ code: "VALIDATION" });

    expect(await isFirstManagerSetupLocked(db)).toBe(false);
  });

  it("refuses to run if the configured secret itself is too short (misconfiguration)", async () => {
    process.env.FIRST_MANAGER_SETUP_SECRET = "too-short";
    try {
      await expect(
        completeFirstManagerSetup(db, auth, { secret: "too-short", password: VALID_PASSWORD })
      ).rejects.toMatchObject({ code: "SETUP_NOT_CONFIGURED" });
    } finally {
      process.env.FIRST_MANAGER_SETUP_SECRET = STRONG_SECRET;
    }
  });
});

describe("completeFirstManagerSetup — success path", () => {
  it("creates the Auth user, sets the manager claim, writes users/{uid}, and seeds settings/app", async () => {
    const { uid } = await completeFirstManagerSetup(db, auth, {
      secret: STRONG_SECRET,
      password: VALID_PASSWORD,
    });

    const authUser = await auth.getUser(uid);
    expect(authUser.email).toBe(FIRST_MANAGER_EMAIL);
    expect(authUser.customClaims?.role).toBe("manager");

    const userDoc = await db.collection("users").doc(uid).get();
    expect(userDoc.exists).toBe(true);
    expect(userDoc.data()).toMatchObject({
      email: FIRST_MANAGER_EMAIL,
      name: FIRST_MANAGER_NAME,
      role: "manager",
      active: true,
    });

    const settingsDoc = await db.collection("settings").doc("app").get();
    expect(settingsDoc.exists).toBe(true);
    expect(settingsDoc.data()?.timezone).toBe("Asia/Bahrain");

    const setupState = await db.collection("settings").doc("setupState").get();
    expect(setupState.data()?.firstManagerCreated).toBe(true);
    expect(setupState.data()?.managerUid).toBe(uid);

    expect(await isFirstManagerSetupLocked(db)).toBe(true);
  });

  it("does not overwrite an existing settings/app document", async () => {
    await db.collection("settings").doc("app").set({
      businessName: "اسم مخصص بالفعل",
      timezone: "Asia/Bahrain",
      updatedAt: new Date(),
      updatedBy: "seed",
    });

    await completeFirstManagerSetup(db, auth, { secret: STRONG_SECRET, password: VALID_PASSWORD });

    const settingsDoc = await db.collection("settings").doc("app").get();
    expect(settingsDoc.data()?.businessName).toBe("اسم مخصص بالفعل");
  });
});

describe("completeFirstManagerSetup — permanent lock", () => {
  it("rejects a second attempt with the correct secret after the first succeeds", async () => {
    const first = await completeFirstManagerSetup(db, auth, {
      secret: STRONG_SECRET,
      password: VALID_PASSWORD,
    });

    await expect(
      completeFirstManagerSetup(db, auth, { secret: STRONG_SECRET, password: "AnotherStr0ngPass!" })
    ).rejects.toMatchObject({ code: "SETUP_ALREADY_COMPLETED" });

    // The original account is untouched by the rejected second attempt.
    const authUser = await auth.getUser(first.uid);
    expect(authUser.email).toBe(FIRST_MANAGER_EMAIL);
    const managers = await db.collection("users").where("role", "==", "manager").get();
    expect(managers.size).toBe(1);
  });

  it("locks permanently (and rejects) if an active manager already exists via another path", async () => {
    await seedActiveManager("manager-created-elsewhere");

    await expect(
      completeFirstManagerSetup(db, auth, { secret: STRONG_SECRET, password: VALID_PASSWORD })
    ).rejects.toMatchObject({ code: "SETUP_ALREADY_COMPLETED" });

    expect(await isFirstManagerSetupLocked(db)).toBe(true);
    // No account was created for the setup-flow email in this scenario.
    await expect(auth.getUserByEmail(FIRST_MANAGER_EMAIL)).rejects.toBeTruthy();
  });

  it("resolves two concurrent setup attempts with exactly one winner", async () => {
    const results = await Promise.allSettled([
      completeFirstManagerSetup(db, auth, { secret: STRONG_SECRET, password: VALID_PASSWORD }),
      completeFirstManagerSetup(db, auth, { secret: STRONG_SECRET, password: "AnotherStr0ngPass!" }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    if (rejected[0].status === "rejected") {
      expect(rejected[0].reason).toBeInstanceOf(ServiceError);
    }

    const managers = await db.collection("users").where("role", "==", "manager").get();
    expect(managers.size).toBe(1);
  });
});
