import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { SESSION_COOKIE_NAME, SESSION_MAX_AGE_SECONDS } from "@/lib/auth/constants";

export async function POST(request: Request) {
  const { idToken } = (await request.json()) as { idToken?: string };
  if (!idToken) {
    return NextResponse.json({ error: "رمز الدخول مفقود" }, { status: 400 });
  }

  const adminAuth = getAdminAuth();

  let decoded;
  try {
    decoded = await adminAuth.verifyIdToken(idToken, true);
  } catch {
    return NextResponse.json({ error: "تعذر التحقق من الهوية" }, { status: 401 });
  }

  let role = decoded.role as string | undefined;

  const userDoc = await getAdminDb().collection("users").doc(decoded.uid).get();
  const userData = userDoc.data();

  if (!userDoc.exists || !userData) {
    return NextResponse.json({ error: "الحساب غير مسجل في النظام" }, { status: 403 });
  }
  if (userData.active === false) {
    return NextResponse.json({ error: "تم إيقاف هذا الحساب" }, { status: 403 });
  }
  if (!role && userData.role) {
    role = userData.role as string;
    await adminAuth.setCustomUserClaims(decoded.uid, { role });
  }
  if (role !== "employee" && role !== "manager") {
    return NextResponse.json({ error: "لم يتم تحديد صلاحية هذا الحساب" }, { status: 403 });
  }

  const sessionCookie = await adminAuth.createSessionCookie(idToken, {
    expiresIn: SESSION_MAX_AGE_SECONDS * 1000,
  });

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, sessionCookie, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });

  await getAdminDb().collection("activityLogs").add({
    type: "login",
    entityType: "user",
    entityId: decoded.uid,
    actingUid: decoded.uid,
    actingEmail: userData.email ?? decoded.email ?? "",
    actingName: userData.name ?? "",
    before: null,
    after: null,
    createdAt: new Date(),
  });

  return NextResponse.json({ role, name: userData.name ?? "" });
}

export async function DELETE() {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE_NAME);
  return NextResponse.json({ ok: true });
}
