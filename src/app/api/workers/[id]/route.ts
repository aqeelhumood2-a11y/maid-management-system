import { NextResponse } from "next/server";
import { getActor, isManagerSession } from "@/lib/auth/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { updateWorkerServer, type WorkerPatch } from "@/lib/server/catalogService";
import { ServiceError } from "@/lib/server/errors";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!(await isManagerSession())) {
    return NextResponse.json({ error: "هذا الإجراء متاح للمدير فقط" }, { status: 401 });
  }

  const { id } = await context.params;
  const body = (await request.json().catch(() => ({}))) as WorkerPatch;

  try {
    await updateWorkerServer(getAdminDb(), id, body, await getActor());
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    return NextResponse.json({ error: "تعذر حفظ التعديل" }, { status: 500 });
  }
}
