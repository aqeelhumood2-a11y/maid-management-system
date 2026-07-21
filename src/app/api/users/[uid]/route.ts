import { NextResponse } from "next/server";
import { requireManagerSession } from "@/lib/auth/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { FieldValue } from "firebase-admin/firestore";

interface PatchBody {
  active?: boolean;
  name?: string;
  role?: "employee" | "manager";
}

export async function PATCH(request: Request, context: { params: Promise<{ uid: string }> }) {
  const auth = await requireManagerSession();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { uid } = await context.params;
  const body = (await request.json()) as PatchBody;

  const adminDb = getAdminDb();
  const ref = adminDb.collection("users").doc(uid);
  const snap = await ref.get();
  if (!snap.exists) return NextResponse.json({ error: "المستخدم غير موجود" }, { status: 404 });
  const before = snap.data()!;

  if (uid === auth.session.uid && body.active === false) {
    return NextResponse.json({ error: "لا يمكنك إيقاف حسابك الخاص" }, { status: 400 });
  }

  const update: Record<string, unknown> = {
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: auth.session.uid,
  };
  if (typeof body.active === "boolean") update.active = body.active;
  if (body.name?.trim()) update.name = body.name.trim();
  if (body.role === "employee" || body.role === "manager") update.role = body.role;

  await ref.update(update);

  if (update.role) {
    await getAdminAuth().setCustomUserClaims(uid, { role: update.role });
  }

  await adminDb.collection("activityLogs").add({
    type: "user_edited",
    entityType: "user",
    entityId: uid,
    actingUid: auth.session.uid,
    actingEmail: auth.session.email,
    actingName: auth.session.name,
    before,
    after: { ...before, ...update },
    createdAt: FieldValue.serverTimestamp(),
  });

  return NextResponse.json({ ok: true });
}
