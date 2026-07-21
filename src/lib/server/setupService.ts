import type { Auth } from "firebase-admin/auth";
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { BAHRAIN_TZ } from "../date";
import { ServiceError } from "./errors";

/**
 * One-time bootstrap for the very first manager account, invoked
 * automatically from src/instrumentation.ts when a server instance starts —
 * an alternative to running scripts/bootstrap-manager.ts from a terminal.
 * Everything here runs server-side under the Admin SDK; the browser never
 * sees Firebase Admin credentials or the bootstrap password.
 *
 * Safety model: a dedicated settings/setupState document is the permanent
 * lock. It is claimed inside a Firestore transaction that also checks for
 * any already-existing active manager, so two concurrent server startups
 * (or a run after a manager was created some other way) can never both
 * succeed, and once completed the lock is never released. There is no
 * separate secret gate — "no manager exists yet" is the entire precondition,
 * by design, so this requires no extra environment variable to configure.
 */

export const FIRST_MANAGER_EMAIL = "aqeelhumood2@gmail.com";
export const FIRST_MANAGER_NAME = "Aqeel";
export const MIN_SETUP_PASSWORD_LENGTH = 8;

const SETUP_STATE_PATH = ["settings", "setupState"] as const;

function setupStateRef(db: Firestore) {
  return db.collection(SETUP_STATE_PATH[0]).doc(SETUP_STATE_PATH[1]);
}

/** Read-only check for whether the one-time bootstrap has already run. */
export async function isFirstManagerSetupLocked(db: Firestore): Promise<boolean> {
  const snap = await setupStateRef(db).get();
  if (snap.exists && snap.data()?.firstManagerCreated === true) return true;

  const existingManager = await db
    .collection("users")
    .where("role", "==", "manager")
    .where("active", "==", true)
    .limit(1)
    .get();
  return !existingManager.empty;
}

class SetupAlreadyCompletedError extends ServiceError {
  constructor() {
    super("تم إعداد النظام مسبقًا، هذه الصفحة لم تعد متاحة.", "SETUP_ALREADY_COMPLETED", 403);
    this.name = "SetupAlreadyCompletedError";
  }
}

type ClaimResult = { claimed: true } | { claimed: false };

/**
 * Atomically claims the one-time setup slot. Note: a transaction's staged
 * writes are discarded if the callback throws, so the "lock permanently
 * because a manager already exists" write below must happen via a normal
 * return (not a throw) — the caller throws afterwards, once the write has
 * actually committed.
 */
async function claimSetupLock(db: Firestore): Promise<ClaimResult> {
  return db.runTransaction(async (tx) => {
    const ref = setupStateRef(db);
    const snap = await tx.get(ref);
    if (snap.exists && snap.data()?.firstManagerCreated === true) {
      return { claimed: false };
    }

    const existingManager = await tx.get(
      db.collection("users").where("role", "==", "manager").where("active", "==", true).limit(1)
    );
    if (!existingManager.empty) {
      // The precondition ("no active manager exists") no longer holds — lock
      // permanently even though this request didn't create the manager itself.
      tx.set(
        ref,
        {
          firstManagerCreated: true,
          status: "locked-existing-manager",
          completedAt: FieldValue.serverTimestamp(),
          managerUid: null,
        },
        { merge: true }
      );
      return { claimed: false };
    }

    tx.set(
      ref,
      {
        firstManagerCreated: true,
        status: "pending",
        claimedAt: FieldValue.serverTimestamp(),
        completedAt: null,
        managerUid: null,
      },
      { merge: true }
    );
    return { claimed: true };
  });
}

async function releaseSetupLock(db: Firestore): Promise<void> {
  // Best-effort rollback so a genuine failure (e.g. Auth API hiccup) can be
  // retried instead of permanently bricking the bootstrap flow.
  await setupStateRef(db).delete().catch(() => undefined);
}

async function finalizeSetupLock(db: Firestore, uid: string): Promise<void> {
  await setupStateRef(db).set(
    {
      firstManagerCreated: true,
      status: "completed",
      completedAt: FieldValue.serverTimestamp(),
      managerUid: uid,
    },
    { merge: true }
  );
}

export interface CompleteSetupInput {
  password: string;
}

/**
 * Runs the full first-manager bootstrap: claims the permanent lock,
 * creates/updates the Firebase Auth user, sets the manager custom claim,
 * writes users/{uid}, and seeds settings/app.
 */
export async function completeFirstManagerSetup(
  db: Firestore,
  auth: Auth,
  input: CompleteSetupInput
): Promise<{ uid: string }> {
  if (!input.password || input.password.length < MIN_SETUP_PASSWORD_LENGTH) {
    throw new ServiceError(
      `كلمة المرور يجب ألا تقل عن ${MIN_SETUP_PASSWORD_LENGTH} أحرف`,
      "VALIDATION",
      400
    );
  }

  const claim = await claimSetupLock(db);
  if (!claim.claimed) {
    throw new SetupAlreadyCompletedError();
  }

  try {
    let uid: string;
    try {
      const existing = await auth.getUserByEmail(FIRST_MANAGER_EMAIL);
      uid = existing.uid;
      await auth.updateUser(uid, { password: input.password, displayName: FIRST_MANAGER_NAME });
    } catch (err) {
      if ((err as { code?: string })?.code === "auth/user-not-found") {
        const created = await auth.createUser({
          email: FIRST_MANAGER_EMAIL,
          password: input.password,
          displayName: FIRST_MANAGER_NAME,
        });
        uid = created.uid;
      } else {
        throw err;
      }
    }

    await auth.setCustomUserClaims(uid, { role: "manager" });

    const batch = db.batch();
    batch.set(
      db.collection("users").doc(uid),
      {
        email: FIRST_MANAGER_EMAIL,
        name: FIRST_MANAGER_NAME,
        role: "manager",
        active: true,
        createdAt: FieldValue.serverTimestamp(),
        createdBy: "first-manager-setup",
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: "first-manager-setup",
      },
      { merge: true }
    );

    const settingsRef = db.collection("settings").doc("app");
    const settingsSnap = await settingsRef.get();
    if (!settingsSnap.exists) {
      batch.set(settingsRef, {
        businessName: "نظام إدارة العاملات",
        timezone: BAHRAIN_TZ,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: uid,
      });
    }

    batch.set(db.collection("activityLogs").doc(), {
      type: "first_manager_setup",
      entityType: "user",
      entityId: uid,
      actingUid: uid,
      actingEmail: FIRST_MANAGER_EMAIL,
      actingName: FIRST_MANAGER_NAME,
      before: null,
      after: { email: FIRST_MANAGER_EMAIL, name: FIRST_MANAGER_NAME, role: "manager", active: true },
      createdAt: FieldValue.serverTimestamp(),
    });

    await batch.commit();
    await finalizeSetupLock(db, uid);

    return { uid };
  } catch (err) {
    await releaseSetupLock(db);
    throw err;
  }
}
