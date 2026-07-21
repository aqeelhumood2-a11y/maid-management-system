import { NextResponse } from "next/server";
import { getActor, isManagerSession } from "@/lib/auth/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { createWorkerServer } from "@/lib/server/catalogService";
import { ServiceError } from "@/lib/server/errors";
import type { Worker } from "@/lib/types";

/** Read is open to everyone — employees need the worker list for the schedule grid. */
export async function GET() {
  const snap = await getAdminDb().collection("workers").orderBy("name").get();
  const workers = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Worker);
  return NextResponse.json({ workers });
}

export async function POST(request: Request) {
  if (!(await isManagerSession())) {
    return NextResponse.json({ error: "هذا الإجراء متاح للمدير فقط" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as { name?: string; phone?: string };

  try {
    const id = await createWorkerServer(
      getAdminDb(),
      { name: body.name ?? "", phone: body.phone ?? "" },
      await getActor()
    );
    return NextResponse.json({ id });
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    return NextResponse.json({ error: "تعذر إضافة العاملة" }, { status: 500 });
  }
}
