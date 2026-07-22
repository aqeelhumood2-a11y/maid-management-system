import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { ServiceError } from "./errors";
import type { Actor } from "./bookingService";

/**
 * There is no Firebase Authentication anywhere in this app anymore.
 * Employees are fully anonymous — they are never asked for any credential.
 * The manager surface is gated by a single shared password, checked here,
 * server-side only. This value is a real credential committed to source
 * (the same pattern this project has always used for one-time/shared
 * credentials) — never sent to the browser, never imported by any
 * "use client" file.
 */
const MANAGER_PASSWORD = "33199666";

/** HMAC key for signing the manager session cookie. Server-only, never exposed to the client. */
const SESSION_SECRET = "54bf2906581e60e5a4aa3cf872ea380b25bd0abe4ac2ce763cca71ca33dd1ed1";

export const MANAGER_SESSION_COOKIE_NAME = "manager_session";
export const MANAGER_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 5; // 5 days

function timingSafeStringEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function isManagerPasswordCorrect(password: string): boolean {
  if (typeof password !== "string" || password.length === 0) return false;
  return timingSafeStringEqual(password, MANAGER_PASSWORD);
}

function sign(payload: string): string {
  return createHmac("sha256", SESSION_SECRET).update(payload).digest("hex");
}

/** Issues a signed, expiring manager session token to store in the cookie. */
export function createManagerSessionToken(): string {
  const expiresAt = Date.now() + MANAGER_SESSION_MAX_AGE_SECONDS * 1000;
  const payload = String(expiresAt);
  return `${payload}.${sign(payload)}`;
}

/** Verifies the signature and expiry of a manager session cookie value. */
export function isValidManagerSessionToken(token: string | undefined | null): boolean {
  if (!token) return false;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return false;
  if (!timingSafeStringEqual(sign(payload), signature)) return false;
  const expiresAt = Number(payload);
  if (!Number.isFinite(expiresAt) || Date.now() >= expiresAt) return false;
  return true;
}

/**
 * Best-effort brute-force throttle for the password check. In-memory only,
 * so it resets on cold start and isn't shared across serverless instances —
 * a real speed bump for casual guessing, not a substitute for the password
 * itself being reasonably strong.
 */
const MAX_ATTEMPTS = 8;
const WINDOW_MS = 10 * 60 * 1000;
const attemptsByIp = new Map<string, { count: number; resetAt: number }>();

export function isRateLimited(ip: string): boolean {
  const entry = attemptsByIp.get(ip);
  if (!entry || Date.now() >= entry.resetAt) return false;
  return entry.count >= MAX_ATTEMPTS;
}

export function recordFailedAttempt(ip: string): void {
  const entry = attemptsByIp.get(ip);
  if (!entry || Date.now() >= entry.resetAt) {
    attemptsByIp.set(ip, { count: 1, resetAt: Date.now() + WINDOW_MS });
    return;
  }
  entry.count += 1;
}

export function clearAttempts(ip: string): void {
  attemptsByIp.delete(ip);
}

/**
 * Changeable password storage. The hardcoded `MANAGER_PASSWORD` above stays
 * as the default/fallback for a fresh install that has never changed it;
 * once a manager sets a new one via the Settings → Change Password screen,
 * this Firestore doc becomes authoritative and the hardcoded default stops
 * working — the old password must no longer log anyone in. Only the salted
 * hash is ever persisted, never the plaintext password.
 */
const MANAGER_PASSWORD_DOC_PATH = ["settings", "managerAuth"] as const;
const SCRYPT_KEYLEN = 64;
const MIN_PASSWORD_LENGTH = 4;

function hashPassword(password: string): { salt: string; hash: string } {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN).toString("hex");
  return { salt, hash };
}

function verifyPasswordHash(password: string, salt: string, hash: string): boolean {
  const expected = Buffer.from(hash, "hex");
  const candidate = scryptSync(password, salt, SCRYPT_KEYLEN);
  if (candidate.length !== expected.length) return false;
  return timingSafeEqual(candidate, expected);
}

/**
 * The one function every login attempt should actually be checked against
 * — prefers the stored hash if the manager has ever changed the password,
 * falling back to the original hardcoded default otherwise.
 */
export async function verifyManagerPassword(db: Firestore, password: string): Promise<boolean> {
  if (typeof password !== "string" || password.length === 0) return false;
  const snap = await db.collection(MANAGER_PASSWORD_DOC_PATH[0]).doc(MANAGER_PASSWORD_DOC_PATH[1]).get();
  if (snap.exists) {
    const data = snap.data() as { salt: string; hash: string };
    return verifyPasswordHash(password, data.salt, data.hash);
  }
  return isManagerPasswordCorrect(password);
}

/**
 * Manager-only: verifies the current password, validates the new one, and
 * persists its hash. Deliberately does not invalidate the caller's own
 * session — only future login attempts are affected, per "use the new
 * password immediately for the next login."
 */
export async function changeManagerPasswordServer(
  db: Firestore,
  currentPassword: string,
  newPassword: string,
  actor: Actor
): Promise<void> {
  if (actor.role !== "manager") {
    throw new ServiceError("هذا الإجراء متاح للمدير فقط", "FORBIDDEN", 403);
  }
  if (!(await verifyManagerPassword(db, currentPassword))) {
    throw new ServiceError("كلمة المرور الحالية غير صحيحة", "INVALID_PASSWORD", 400);
  }
  if (typeof newPassword !== "string" || newPassword.trim().length < MIN_PASSWORD_LENGTH) {
    throw new ServiceError(
      `كلمة المرور الجديدة يجب أن تكون ${MIN_PASSWORD_LENGTH} أحرف على الأقل`,
      "VALIDATION",
      400
    );
  }

  const { salt, hash } = hashPassword(newPassword);
  const ref = db.collection(MANAGER_PASSWORD_DOC_PATH[0]).doc(MANAGER_PASSWORD_DOC_PATH[1]);
  const batch = db.batch();
  batch.set(ref, {
    salt,
    hash,
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: actor.uid,
  });
  const logRef = db.collection("activityLogs").doc();
  batch.set(logRef, {
    type: "manager_password_changed",
    entityType: "managerAuth",
    entityId: "manager",
    actingUid: actor.uid,
    actingEmail: actor.email,
    actingName: actor.name,
    before: null,
    after: null, // password material is never logged, not even a hash
    createdAt: FieldValue.serverTimestamp(),
  });
  await batch.commit();
}
