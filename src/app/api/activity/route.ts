import { NextResponse } from "next/server";
import { isManagerSession } from "@/lib/auth/server";
import { getAdminDb } from "@/lib/firebase/admin";
import type { ActivityActionType, ActivityLog } from "@/lib/types";

export async function GET(request: Request) {
  if (!(await isManagerSession())) {
    return NextResponse.json({ error: "هذا الإجراء متاح للمدير فقط" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type") as ActivityActionType | null;

  let query = getAdminDb().collection("activityLogs").orderBy("createdAt", "desc").limit(200) as FirebaseFirestore.Query;
  if (type) {
    query = getAdminDb()
      .collection("activityLogs")
      .where("type", "==", type)
      .orderBy("createdAt", "desc")
      .limit(200);
  }

  const snap = await query.get();
  const logs = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as ActivityLog);
  return NextResponse.json({ logs });
}
