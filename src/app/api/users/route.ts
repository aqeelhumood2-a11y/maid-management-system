import { NextResponse } from "next/server";
import { requireManagerSession } from "@/lib/auth/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { FieldValue } from "firebase-admin/firestore";

interface CreateUserBody {
  email: string;
  password: string;
  name: string;
  role: "employee" | "manager";
}

export async function GET() {
  const auth = await requireManagerSession();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const snap = await getAdminDb().collection("users").orderBy("createdAt", "desc").get();
  const users = snap.docs.map((d) => {
    const data = d.data();
    return {
      uid: d.id,
      email: data.email,
      name: data.name,
      role: data.role,
      active: data.active,
    };
  });
  return NextResponse.json({ users });
}

export async function POST(request: Request) {
  const auth = await requireManagerSession();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = (await request.json()) as CreateUserBody;
  const email = body.email?.trim();
  const name = body.name?.trim();
  const role = body.role;

  if (!email || !body.password || !name || (role !== "employee" && role !== "manager")) {
    return NextResponse.json({ error: "البيانات المدخلة غير مكتملة" }, { status: 400 });
  }
  if (body.password.length < 6) {
    return NextResponse.json({ error: "كلمة المرور يجب ألا تقل عن 6 أحرف" }, { status: 400 });
  }

  const adminAuth = getAdminAuth();
  const adminDb = getAdminDb();

  let createdUid: string;
  try {
    const userRecord = await adminAuth.createUser({ email, password: body.password, displayName: name });
    createdUid = userRecord.uid;
  } catch (err) {
    const code = (err as { code?: string })?.code;
    const message = code === "auth/email-already-exists" ? "البريد الإلكتروني مستخدم بالفعل" : "تعذر إنشاء الحساب";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  await adminAuth.setCustomUserClaims(createdUid, { role });

  await adminDb.collection("users").doc(createdUid).set({
    email,
    name,
    role,
    active: true,
    createdAt: FieldValue.serverTimestamp(),
    createdBy: auth.session.uid,
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: auth.session.uid,
  });

  await adminDb.collection("activityLogs").add({
    type: "user_added",
    entityType: "user",
    entityId: createdUid,
    actingUid: auth.session.uid,
    actingEmail: auth.session.email,
    actingName: auth.session.name,
    before: null,
    after: { email, name, role, active: true },
    createdAt: FieldValue.serverTimestamp(),
  });

  return NextResponse.json({ uid: createdUid });
}
