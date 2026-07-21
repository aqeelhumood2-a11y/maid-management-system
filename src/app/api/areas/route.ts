import { NextResponse } from "next/server";
import { getActor, isManagerSession } from "@/lib/auth/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { createAreaServer } from "@/lib/server/catalogService";
import { ServiceError } from "@/lib/server/errors";
import type { Area } from "@/lib/types";

/** Read is open to everyone — employees need the area list for booking forms. */
export async function GET() {
  const snap = await getAdminDb().collection("areas").orderBy("name").get();
  const areas = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Area);
  return NextResponse.json({ areas });
}

export async function POST(request: Request) {
  if (!(await isManagerSession())) {
    return NextResponse.json({ error: "هذا الإجراء متاح للمدير فقط" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as { name?: string };

  try {
    const id = await createAreaServer(getAdminDb(), body.name ?? "", await getActor());
    return NextResponse.json({ id });
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    return NextResponse.json({ error: "تعذر إضافة المنطقة" }, { status: 500 });
  }
}
