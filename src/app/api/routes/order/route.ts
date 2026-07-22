import { NextResponse } from "next/server";
import { getActor, isManagerSession } from "@/lib/auth/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { getRouteOrderServer, saveRouteOrderServer } from "@/lib/server/routeOrderService";
import { ServiceError } from "@/lib/server/errors";
import type { Shift } from "@/lib/types";

function parseShift(value: string | null): Shift | null {
  return value === "morning" || value === "afternoon" ? value : null;
}

/** Read is open to everyone — the Employee Daily Route must follow the manager's saved order. */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date");
  const shift = parseShift(searchParams.get("shift"));
  if (!date || !shift) {
    return NextResponse.json({ error: "معطيات الاستعلام غير مكتملة" }, { status: 400 });
  }

  const workerIds = await getRouteOrderServer(getAdminDb(), date, shift);
  return NextResponse.json({ workerIds });
}

/** Manager only — saves the Daily Route's manually-arranged order for one date+shift. */
export async function PATCH(request: Request) {
  if (!(await isManagerSession())) {
    return NextResponse.json({ error: "هذا الإجراء متاح للمدير فقط" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    date?: string;
    shift?: string;
    workerIds?: string[];
  };
  const shift = parseShift(body.shift ?? null);
  if (!body.date || !shift) {
    return NextResponse.json({ error: "معطيات غير مكتملة" }, { status: 400 });
  }

  try {
    await saveRouteOrderServer(getAdminDb(), body.date, shift, body.workerIds ?? [], await getActor());
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    return NextResponse.json({ error: "تعذر حفظ الترتيب" }, { status: 500 });
  }
}
