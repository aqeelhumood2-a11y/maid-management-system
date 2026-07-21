import { cookies } from "next/headers";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { SESSION_COOKIE_NAME } from "./constants";
import type { Role } from "@/lib/types";

export interface ServerSession {
  uid: string;
  email: string;
  name: string;
  role: Role;
}

/**
 * Fully verifies the session cookie (signature, expiry, revocation) and re-reads
 * the user's Firestore record so a deactivation or role change takes effect on the
 * very next request, not just on next login. This is the real authorization
 * boundary for pages — Proxy only does a cheap optimistic redirect.
 */
export async function getServerSession(): Promise<ServerSession | null> {
  const cookieStore = await cookies();
  const cookie = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!cookie) return null;

  try {
    const decoded = await getAdminAuth().verifySessionCookie(cookie, true);
    const userDoc = await getAdminDb().collection("users").doc(decoded.uid).get();
    const userData = userDoc.data();
    if (!userDoc.exists || !userData || userData.active === false) return null;
    if (userData.role !== "employee" && userData.role !== "manager") return null;

    return {
      uid: decoded.uid,
      email: userData.email ?? decoded.email ?? "",
      name: userData.name ?? "",
      role: userData.role as Role,
    };
  } catch {
    return null;
  }
}

export async function requireManagerSession(): Promise<
  { ok: true; session: ServerSession } | { ok: false; status: number; error: string }
> {
  const session = await getServerSession();
  if (!session) return { ok: false, status: 401, error: "يجب تسجيل الدخول" };
  if (session.role !== "manager") {
    return { ok: false, status: 403, error: "هذا الإجراء متاح للمدير فقط" };
  }
  return { ok: true, session };
}
