import { NextResponse, type NextRequest } from "next/server";
import { isValidManagerSessionToken, MANAGER_SESSION_COOKIE_NAME } from "@/lib/server/managerAuth";

/**
 * There is no Firebase Authentication in this app, and no login page.
 * Employee routes ("/", "/weekly") are open to everyone — nothing to gate.
 * The only thing Proxy protects is "/manager": an optimistic, fast redirect
 * for the obvious case (missing/invalid cookie) so a stale bookmark doesn't
 * even reach the page. The real, authoritative check happens again in
 * src/app/manager/layout.tsx (a Server Component) on every request — Proxy
 * is a UX shortcut, not the security boundary, though in this case both
 * checks run the exact same signature verification since it's cheap.
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/manager")) {
    const cookie = request.cookies.get(MANAGER_SESSION_COOKIE_NAME)?.value;
    if (!isValidManagerSessionToken(cookie)) {
      return NextResponse.redirect(new URL("/", request.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/).*)"],
};
