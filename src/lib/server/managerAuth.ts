import { createHmac, timingSafeEqual } from "node:crypto";

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
