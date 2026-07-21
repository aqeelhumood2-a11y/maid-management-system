import {
  assertFails,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { readFileSync } from "node:fs";
import { afterAll, afterEach, beforeAll, describe, it } from "vitest";
import { addDoc, collection, doc, getDoc, getDocs, serverTimestamp, setDoc } from "firebase/firestore";

/**
 * There is no Firebase Authentication anywhere in this app, so there is no
 * "signed-in client" scenario left to test — every collection must deny
 * every direct client read and write, unconditionally, for both an
 * unauthenticated context and (for completeness) a context that merely
 * claims to be signed in as some uid, since nothing in the app ever issues
 * a real Firebase Auth token for one to exist. Everything goes through
 * Next.js API routes using the Admin SDK, which bypasses these rules
 * entirely — that trusted server layer (src/lib/server/bookingService.ts,
 * recurringService.ts, catalogService.ts) is exercised directly against the
 * emulator in tests/emulator/transactions.test.ts.
 */

const PROJECT_ID = "demo-maid-mgmt-rules";

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync("firestore.rules", "utf8"),
      host: "127.0.0.1",
      port: 8080,
    },
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

afterEach(async () => {
  await testEnv.clearFirestore();
});

const COLLECTIONS = [
  "users",
  "workers",
  "areas",
  "slots",
  "bookings",
  "recurringSchedules",
  "recurringExceptions",
  "activityLogs",
  "settings",
];

describe.each(COLLECTIONS)("%s collection — no direct client access", (collectionName) => {
  it("denies reads for an unauthenticated client", async () => {
    const anonDb = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDocs(collection(anonDb, collectionName)));
  });

  it("denies reads even for a context claiming an arbitrary uid (no real Auth token ever exists)", async () => {
    const claimedDb = testEnv.authenticatedContext("someone").firestore();
    await assertFails(getDoc(doc(claimedDb, collectionName, "any-doc")));
  });

  it("denies an unauthenticated write", async () => {
    const anonDb = testEnv.unauthenticatedContext().firestore();
    await assertFails(addDoc(collection(anonDb, collectionName), { probe: true }));
  });

  it("denies a write even for a context claiming an arbitrary uid", async () => {
    const claimedDb = testEnv.authenticatedContext("someone").firestore();
    await assertFails(
      setDoc(doc(claimedDb, collectionName, "probe-doc"), {
        probe: true,
        updatedAt: serverTimestamp(),
      })
    );
  });
});
