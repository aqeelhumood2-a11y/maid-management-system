import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

/**
 * Firestore (the database) only — there is no Firebase Authentication
 * anywhere in this app. Deliberately never imports "firebase-admin/auth":
 * that subpath pulls in jwks-rsa, which pulls in an ESM-only jose build
 * that crashes under Node's CJS require() on some runtimes. Since nothing
 * here ever needs it, it's simplest to just never load it.
 */

/**
 * Normalizes a private key pasted into a hosting provider's env var UI.
 * Two mistakes are common enough to defend against directly:
 *  - Newlines get escaped as literal `\n` when a multi-line value is forced
 *    into a single-line field — convert those back to real newlines.
 *  - The whole value (including its surrounding quote characters) gets
 *    copy-pasted from a JSON service account file — strip a single matching
 *    pair of leading/trailing quotes if present.
 * Without this, `cert()` throws an opaque "Failed to parse private key"
 * error that's easy to mistake for missing credentials entirely.
 */
function normalizePrivateKey(raw: string): string {
  let key = raw.trim();
  if (
    key.length >= 2 &&
    ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'")))
  ) {
    key = key.slice(1, -1);
  }
  return key.replace(/\\n/g, "\n");
}

/**
 * Reads the first non-empty env var among `names`, in order. Used so the
 * ADMIN-prefixed variable is preferred when both are set, without requiring
 * anyone to rename/recreate variables already configured in Vercel.
 */
function readEnv(...names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return undefined;
}

function getAdminApp(): App {
  const apps = getApps();
  if (apps.length) return apps[0];

  if (process.env.FIRESTORE_EMULATOR_HOST) {
    return initializeApp({
      projectId:
        readEnv("FIREBASE_ADMIN_PROJECT_ID", "FIREBASE_PROJECT_ID") || "demo-maid-management",
    });
  }

  const projectId = readEnv("FIREBASE_ADMIN_PROJECT_ID", "FIREBASE_PROJECT_ID");
  const clientEmail = readEnv("FIREBASE_ADMIN_CLIENT_EMAIL", "FIREBASE_CLIENT_EMAIL");
  const rawPrivateKey = readEnv("FIREBASE_ADMIN_PRIVATE_KEY", "FIREBASE_PRIVATE_KEY");
  const privateKey = rawPrivateKey ? normalizePrivateKey(rawPrivateKey) : undefined;

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
      "Firebase Admin credentials are missing. Set FIREBASE_ADMIN_PROJECT_ID (or FIREBASE_PROJECT_ID), " +
        "FIREBASE_ADMIN_CLIENT_EMAIL (or FIREBASE_CLIENT_EMAIL) and FIREBASE_ADMIN_PRIVATE_KEY (or FIREBASE_PRIVATE_KEY)."
    );
  }

  return initializeApp({
    credential: cert({ projectId, clientEmail, privateKey }),
  });
}

export function getAdminDb() {
  return getFirestore(getAdminApp());
}
