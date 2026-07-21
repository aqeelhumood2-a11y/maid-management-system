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

// Public even without a session: the one-time first-manager bootstrap page
// is meant to be reached by someone who has no account yet. It enforces its
// own permanent one-time lock server-side (see src/lib/server/setupService.ts).
const PUBLIC_PATHS = new Set(["/login", "/setup-first-manager"]);

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const cookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;

  if (PUBLIC_PATHS.has(pathname)) {
    if (pathname === "/login" && cookie) return NextResponse.redirect(new URL("/today", request.url));
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
