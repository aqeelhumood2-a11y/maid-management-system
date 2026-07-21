import { NextResponse, type NextRequest } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { FIRST_MANAGER_BOOTSTRAP_PASSWORD } from "@/lib/server/bootstrapCredentials";
import { DIAGNOSTICS_TOKEN } from "@/lib/server/diagnosticsToken";
import {
  completeFirstManagerSetup,
  FIRST_MANAGER_EMAIL,
  isFirstManagerSetupLocked,
} from "@/lib/server/setupService";

/**
 * Temporary production diagnostics for the first-manager bootstrap/login
 * issue — see diagnosticsToken.ts. Never returns the Admin private key or
 * the bootstrap password itself; only account metadata needed to tell
 * exactly which step of the bootstrap has or hasn't run against the real
 * production Firebase project. Requires ?token=... (or the
 * x-diagnostics-token header) matching DIAGNOSTICS_TOKEN, and responds 404
 * (not 401/403) when it doesn't, so an unauthenticated visitor can't even
 * tell this route exists.
 *
 * Pass ?run=true to additionally invoke completeFirstManagerSetup() for
 * real and capture whatever it throws — this is the direct way to see the
 * exact exception, rather than relying on Vercel Runtime Logs having
 * captured (and still retaining) it.
 */
function errorInfo(err: unknown) {
  return {
    code: (err as { code?: string })?.code ?? null,
    message: err instanceof Error ? err.message : String(err),
  };
}

export async function GET(request: NextRequest) {
  const token =
    request.nextUrl.searchParams.get("token") ?? request.headers.get("x-diagnostics-token");
  if (token !== DIAGNOSTICS_TOKEN) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const result: Record<string, unknown> = { checkedAt: new Date().toISOString() };

  let adminAuth: ReturnType<typeof getAdminAuth>;
  let adminDb: ReturnType<typeof getAdminDb>;
  try {
    adminAuth = getAdminAuth();
    adminDb = getAdminDb();
    result.adminSdk = { initialized: true };
  } catch (err) {
    result.adminSdk = { initialized: false, error: errorInfo(err) };
    return NextResponse.json(result, { status: 200 });
  }

  let uid: string | null = null;
  try {
    const user = await adminAuth.getUserByEmail(FIRST_MANAGER_EMAIL);
    uid = user.uid;
    result.authUser = {
      found: true,
      uid: user.uid,
      email: user.email,
      disabled: user.disabled,
      hasPasswordHash: Boolean(user.passwordHash),
      customClaims: user.customClaims ?? null,
      creationTime: user.metadata.creationTime,
      lastSignInTime: user.metadata.lastSignInTime,
      lastRefreshTime: user.metadata.lastRefreshTime ?? null,
    };
  } catch (err) {
    result.authUser = { found: false, error: errorInfo(err) };
  }

  try {
    if (uid) {
      const snap = await adminDb.collection("users").doc(uid).get();
      result.userDoc = snap.exists ? snap.data() : null;
    } else {
      result.userDoc = null;
    }
  } catch (err) {
    result.userDocError = errorInfo(err);
  }

  try {
    const snap = await adminDb.collection("settings").doc("setupState").get();
    result.setupState = snap.exists ? snap.data() : null;
  } catch (err) {
    result.setupStateError = errorInfo(err);
  }

  try {
    result.isLocked = await isFirstManagerSetupLocked(adminDb);
  } catch (err) {
    result.isLockedError = errorInfo(err);
  }

  if (request.nextUrl.searchParams.get("run") === "true") {
    try {
      const { uid: reconciledUid } = await completeFirstManagerSetup(adminDb, adminAuth, {
        password: FIRST_MANAGER_BOOTSTRAP_PASSWORD,
      });
      result.bootstrapRun = { attempted: true, success: true, uid: reconciledUid };
    } catch (err) {
      result.bootstrapRun = { attempted: true, success: false, error: errorInfo(err) };
    }
  } else {
    result.bootstrapRun = { attempted: false };
  }

  return NextResponse.json(result, { status: 200 });
}
