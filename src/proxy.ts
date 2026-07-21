import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE_NAME } from "@/lib/auth/constants";

/**
 * Optimistic, unverified peek at the session cookie's JWT payload — cheap and fast,
 * suitable for Proxy. It is NOT the security boundary: real cryptographic
 * verification (and the active-account check) happens in the protected layouts'
 * Server Components and in Firestore security rules. This only gives legitimate
 * users a fast redirect and denies the obvious "no cookie at all" case.
 */
function peekRole(token: string): string | null {
  try {
    const payload = token.split(".")[1];
    const json = Buffer.from(payload, "base64").toString("utf8");
    const parsed = JSON.parse(json) as { role?: string };
    return parsed.role ?? null;
  } catch {
    return null;
  }
}

/**
 * Guaranteed trigger for the one-time first-manager bootstrap.
 *
 * `src/instrumentation.ts`'s `register()` hook only fires once an actual
 * Node.js server instance starts — but `/login` is a statically prerendered
 * page, and its sign-in form calls Firebase Auth directly from the browser.
 * That means a visitor's entire session can complete (load /login, attempt
 * to sign in, fail) without a single line of our server code ever running,
 * on platforms that serve static routes straight from an edge cache. Proxy
 * is the one thing guaranteed to run on every matched request regardless —
 * it's the routing gate itself — so this is the reliable place for it.
 *
 * Kept cheap in steady state: `attempted` is set synchronously before the
 * async work starts, so a warm instance only ever does this once, and after
 * the first successful run it's a single Firestore read via the permanent
 * settings/setupState lock (see completeFirstManagerSetup). A hard timeout
 * keeps a Firebase connectivity problem from ever hanging a real request.
 */
let bootstrapAttempted = false;

async function ensureFirstManagerBootstrapped(): Promise<void> {
  if (bootstrapAttempted) return;
  bootstrapAttempted = true;

  const timeout = new Promise<void>((resolve) => setTimeout(resolve, 8000));

  const run = (async () => {
    try {
      const { getAdminAuth, getAdminDb } = await import("@/lib/firebase/admin");
      const { completeFirstManagerSetup } = await import("@/lib/server/setupService");
      const { FIRST_MANAGER_BOOTSTRAP_PASSWORD } = await import("@/lib/server/bootstrapCredentials");

      const { uid } = await completeFirstManagerSetup(getAdminDb(), getAdminAuth(), {
        password: FIRST_MANAGER_BOOTSTRAP_PASSWORD,
      });
      console.log(`[bootstrap] First manager account ready (uid: ${uid}).`);
    } catch (err) {
      if ((err as { code?: string })?.code === "SETUP_ALREADY_COMPLETED") return;
      console.error("[bootstrap] First manager auto-setup did not complete:", err);
    }
  })();

  await Promise.race([run, timeout]);
}

export async function proxy(request: NextRequest) {
  await ensureFirstManagerBootstrapped();

  const { pathname } = request.nextUrl;
  const cookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;

  if (pathname === "/login") {
    if (cookie) return NextResponse.redirect(new URL("/today", request.url));
    return NextResponse.next();
  }

  if (!cookie) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  if (pathname.startsWith("/manager")) {
    const role = peekRole(cookie);
    if (role !== "manager") {
      return NextResponse.redirect(new URL("/today", request.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/).*)"],
};
