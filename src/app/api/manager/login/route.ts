import { cookies, headers } from "next/headers";
import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { FieldValue } from "firebase-admin/firestore";
import { MANAGER_ACTOR } from "@/lib/auth/server";
import {
  clearAttempts,
  createManagerSessionToken,
  isRateLimited,
  MANAGER_SESSION_COOKIE_NAME,
  MANAGER_SESSION_MAX_AGE_SECONDS,
  recordFailedAttempt,
  verifyManagerPassword,
} from "@/lib/server/managerAuth";

async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
}

export async function POST(request: Request) {
  const ip = await clientIp();
  if (isRateLimited(ip)) {
    return NextResponse.json(
      { error: "محاولات كثيرة جداً، حاول لاحقاً" },
      { status: 429 }
    );
  }

  const { password } = (await request.json().catch(() => ({}))) as { password?: string };

  if (!(await verifyManagerPassword(getAdminDb(), password ?? ""))) {
    recordFailedAttempt(ip);
    return NextResponse.json({ error: "كلمة المرور غير صحيحة" }, { status: 401 });
  }
  clearAttempts(ip);

  const cookieStore = await cookies();
  cookieStore.set(MANAGER_SESSION_COOKIE_NAME, createManagerSessionToken(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MANAGER_SESSION_MAX_AGE_SECONDS,
  });

  await getAdminDb()
    .collection("activityLogs")
    .add({
      type: "login",
      entityType: "manager",
      entityId: MANAGER_ACTOR.uid,
      actingUid: MANAGER_ACTOR.uid,
      actingEmail: MANAGER_ACTOR.email,
      actingName: MANAGER_ACTOR.name,
      before: null,
      after: null,
      createdAt: FieldValue.serverTimestamp(),
    })
    .catch(() => undefined);

  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  const cookieStore = await cookies();
  cookieStore.delete(MANAGER_SESSION_COOKIE_NAME);
  return NextResponse.json({ ok: true });
}
