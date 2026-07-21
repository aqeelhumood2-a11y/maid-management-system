import { deleteApp, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import {
  deleteApp as deleteClientApp,
  getApps as getClientApps,
  initializeApp as initializeClientApp,
} from "firebase/app";
import {
  connectAuthEmulator,
  getAuth as getClientAuth,
  signInWithEmailAndPassword,
  signOut,
} from "firebase/auth";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ServiceError } from "@/lib/server/errors";
import {
  completeFirstManagerSetup,
  FIRST_MANAGER_EMAIL,
  FIRST_MANAGER_NAME,
  isFirstManagerSetupLocked,
} from "@/lib/server/setupService";

/**
 * Exercises the trusted server layer for the one-time first-manager
 * bootstrap (src/lib/server/setupService.ts), the same code
 * src/instrumentation.ts calls automatically on every server startup. Uses
 * a real Admin Auth instance against the Auth emulator (not the
 * rules-unit-testing fake auth context, which never touches the Auth
 * emulator's user store) so createUser/getUserByEmail/setCustomUserClaims
 * are exercised for real.
 *
 * There is no setup-secret gate — the only precondition is "this specific
 * reconciliation hasn't run yet", enforced by the permanent
 * settings/setupState lock claimed inside a Firestore transaction. Other
 * manager accounts existing (created by hand or some other path) never
 * block reconciliation of FIRST_MANAGER_EMAIL.
 */

let app: App;
let db: Firestore;
let auth: Auth;

const VALID_PASSWORD = "Str0ngPassw0rd!";

const CLIENT_APP_NAME = "setup-test-client-app";

/**
 * Must equal the `--project` flag `npm run test:emulator` passes to
 * `firebase emulators:exec` (see package.json). The Auth Emulator's public,
 * client-facing REST endpoints (signInWithPassword etc.) don't take a
 * project ID in the URL — unlike the Admin SDK's project-scoped endpoints —
 * so with multiple projects loaded into one emulator process (this suite
 * also runs demo-maid-mgmt-tx and demo-maid-mgmt-rules), an ambiguous
 * client request only resolves to the right project bucket when it matches
 * the emulator's default project. Verified empirically against the Auth
 * Emulator: an Admin-created user under a non-default project ID is
 * invisible to a client signInWithEmailAndPassword call.
 */
const PROJECT_ID = "demo-maid-mgmt";

beforeAll(() => {
  const existing = getApps().find((a) => a.name === "setup-test-app");
  app = existing ?? initializeApp({ projectId: PROJECT_ID }, "setup-test-app");
  db = getFirestore(app);
  auth = getAuth(app);
});

afterAll(async () => {
  await deleteApp(app);
});

/**
 * Signs in through the real client SDK against the Auth emulator — the same
 * signInWithEmailAndPassword call src/app/login/page.tsx makes from the
 * browser — so "does the password actually work" is verified end-to-end
 * rather than assumed from the Admin SDK's write succeeding.
 */
async function signInAsClient(password: string): Promise<string> {
  const existingClientApp = getClientApps().find((a) => a.name === CLIENT_APP_NAME);
  const clientApp =
    existingClientApp ??
    initializeClientApp({ apiKey: "fake-api-key", projectId: PROJECT_ID }, CLIENT_APP_NAME);
  const clientAuth = getClientAuth(clientApp);
  connectAuthEmulator(clientAuth, `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`, {
    disableWarnings: true,
  });
  try {
    const cred = await signInWithEmailAndPassword(clientAuth, FIRST_MANAGER_EMAIL, password);
    return cred.user.uid;
  } finally {
    await signOut(clientAuth).catch(() => undefined);
    await deleteClientApp(clientApp).catch(() => undefined);
  }
}

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

  it("stays unlocked when an unrelated active manager exists but reconciliation never ran", async () => {
    // Some other manager account existing (e.g. created by hand through the
    // app) must never block reconciliation of FIRST_MANAGER_EMAIL — only
    // actually running the bootstrap for that specific account should.
    await seedActiveManager("some-other-manager");
    expect(await isFirstManagerSetupLocked(db)).toBe(false);
  });
});

describe("completeFirstManagerSetup — validation", () => {
  it("rejects a password shorter than the minimum and creates nothing", async () => {
    await expect(
      completeFirstManagerSetup(db, auth, { password: "short" })
    ).rejects.toMatchObject({ code: "VALIDATION" });

    expect(await isFirstManagerSetupLocked(db)).toBe(false);
    await expect(auth.getUserByEmail(FIRST_MANAGER_EMAIL)).rejects.toBeTruthy();
  });
});

describe("completeFirstManagerSetup — success path", () => {
  it("creates the Auth user, sets the manager claim, writes users/{uid}, and seeds settings/app", async () => {
    const { uid } = await completeFirstManagerSetup(db, auth, { password: VALID_PASSWORD });

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

    await completeFirstManagerSetup(db, auth, { password: VALID_PASSWORD });

    const settingsDoc = await db.collection("settings").doc("app").get();
    expect(settingsDoc.data()?.businessName).toBe("اسم مخصص بالفعل");
  });
});

describe("completeFirstManagerSetup — permanent lock", () => {
  it("rejects a second attempt after the first succeeds", async () => {
    const first = await completeFirstManagerSetup(db, auth, { password: VALID_PASSWORD });

    await expect(
      completeFirstManagerSetup(db, auth, { password: "AnotherStr0ngPass!" })
    ).rejects.toMatchObject({ code: "SETUP_ALREADY_COMPLETED" });

    // The original account is untouched by the rejected second attempt.
    const authUser = await auth.getUser(first.uid);
    expect(authUser.email).toBe(FIRST_MANAGER_EMAIL);
    const managers = await db.collection("users").where("role", "==", "manager").get();
    expect(managers.size).toBe(1);
  });

  it("still reconciles FIRST_MANAGER_EMAIL when an unrelated active manager already exists", async () => {
    await seedActiveManager("manager-created-elsewhere");

    const { uid } = await completeFirstManagerSetup(db, auth, { password: VALID_PASSWORD });

    const authUser = await auth.getUser(uid);
    expect(authUser.email).toBe(FIRST_MANAGER_EMAIL);
    expect(authUser.customClaims?.role).toBe("manager");

    const userDoc = await db.collection("users").doc(uid).get();
    expect(userDoc.data()).toMatchObject({
      email: FIRST_MANAGER_EMAIL,
      name: FIRST_MANAGER_NAME,
      role: "manager",
      active: true,
    });

    // The unrelated manager account is left completely untouched.
    const otherDoc = await db.collection("users").doc("manager-created-elsewhere").get();
    expect(otherDoc.data()).toMatchObject({ role: "manager", active: true });

    expect(await isFirstManagerSetupLocked(db)).toBe(true);
  });

  it("resets the password and claim for FIRST_MANAGER_EMAIL when the Auth account already exists", async () => {
    // Reproduces the real-world scenario: the Auth user and its users/{uid}
    // doc were created out-of-band (e.g. scripts/bootstrap-manager.ts) with
    // a password the bootstrap doesn't know, and no custom claim set yet.
    const preexisting = await auth.createUser({
      email: FIRST_MANAGER_EMAIL,
      password: "some-forgotten-password",
      displayName: "اسم المدير",
    });
    await db.collection("users").doc(preexisting.uid).set({
      email: FIRST_MANAGER_EMAIL,
      name: "اسم المدير",
      role: "manager",
      active: true,
      createdAt: new Date(),
      createdBy: "manual-script",
      updatedAt: new Date(),
      updatedBy: "manual-script",
    });

    const { uid } = await completeFirstManagerSetup(db, auth, { password: VALID_PASSWORD });
    expect(uid).toBe(preexisting.uid);

    const authUser = await auth.getUser(uid);
    expect(authUser.customClaims?.role).toBe("manager");

    const userDoc = await db.collection("users").doc(uid).get();
    expect(userDoc.data()).toMatchObject({
      email: FIRST_MANAGER_EMAIL,
      name: FIRST_MANAGER_NAME,
      role: "manager",
      active: true,
    });

    // The real end-to-end check for "Invalid email or password": actually
    // sign in with signInWithEmailAndPassword, the exact call the browser
    // makes, using the new bootstrap password.
    const signedInUid = await signInAsClient(VALID_PASSWORD);
    expect(signedInUid).toBe(uid);

    // The old, forgotten password must no longer work.
    await expect(signInAsClient("some-forgotten-password")).rejects.toMatchObject({
      code: "auth/wrong-password",
    });
  });

  it("resolves two concurrent setup attempts with exactly one winner", async () => {
    const results = await Promise.allSettled([
      completeFirstManagerSetup(db, auth, { password: VALID_PASSWORD }),
      completeFirstManagerSetup(db, auth, { password: "AnotherStr0ngPass!" }),
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
