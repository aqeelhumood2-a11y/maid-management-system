import type { Auth } from "firebase-admin/auth";
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { BAHRAIN_TZ } from "../date";
import { ServiceError } from "./errors";

/**
 * One-time bootstrap/reconciliation for the designated first manager account
 * (FIRST_MANAGER_EMAIL), invoked automatically from src/instrumentation.ts
 * and src/proxy.ts whenever a server instance starts or handles a request.
 * Everything here runs server-side under the Admin SDK; the browser never
 * sees Firebase Admin credentials or the bootstrap password.
 *
 * Safety model: a dedicated settings/setupState document is the permanent
 * lock, claimed inside a Firestore transaction so concurrent attempts can
 * never both win. Crucially, the lock tracks only "has FIRST_MANAGER_EMAIL
 * been reconciled", not "does any manager exist" — this account may have
 * been created out-of-band (e.g. via scripts/bootstrap-manager.ts) with a
 * users/{uid} doc already present, and other, unrelated manager accounts
 * may also exist. Neither of those should ever prevent this flow from
 * ensuring FIRST_MANAGER_EMAIL specifically has the right Auth password,
 * the manager custom claim, and a correctly-shaped users/{uid} doc — it
 * only ever reads/writes that one account. There is no separate secret
 * gate, so this requires no extra environment variable to configure.
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
  return snap.exists && snap.data()?.firstManagerCreated === true;
}

class SetupAlreadyCompletedError extends ServiceError {
  constructor() {
    super("تم إعداد النظام مسبقًا، هذه الصفحة لم تعد متاحة.", "SETUP_ALREADY_COMPLETED", 403);
    this.name = "SetupAlreadyCompletedError";
  }
}

type ClaimResult = { claimed: true } | { claimed: false };

/**
 * Atomically claims the one-time reconciliation slot for FIRST_MANAGER_EMAIL.
 * This intentionally does NOT check whether some other manager account
 * exists — the only thing that should ever block this from running is that
 * it already ran (see the module doc comment above).
 */
async function claimSetupLock(db: Firestore): Promise<ClaimResult> {
  return db.runTransaction(async (tx) => {
    const ref = setupStateRef(db);
    const snap = await tx.get(ref);
    if (snap.exists && snap.data()?.firstManagerCreated === true) {
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
