import { NextResponse } from "next/server";
import { getActor, isManagerSession } from "@/lib/auth/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { BAHRAIN_TZ } from "@/lib/date";
import { updateSettingsServer } from "@/lib/server/catalogService";
import { ServiceError } from "@/lib/server/errors";
import type { AppSettings } from "@/lib/types";

const DEFAULT_SETTINGS: AppSettings = {
  businessName: "نظام إدارة العاملات",
  timezone: BAHRAIN_TZ,
  updatedAt: null,
  updatedBy: null,
};

/** Read is open to everyone — the business name is shown in the header. */
export async function GET() {
  try {
    const snap = await getAdminDb().collection("settings").doc("app").get();
    const settings = snap.exists ? (snap.data() as AppSettings) : DEFAULT_SETTINGS;
    return NextResponse.json({ settings });
  } catch {
    return NextResponse.json({ settings: DEFAULT_SETTINGS });
  }
}

export async function PATCH(request: Request) {
  if (!(await isManagerSession())) {
    return NextResponse.json({ error: "هذا الإجراء متاح للمدير فقط" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as { businessName?: string };

  try {
    await updateSettingsServer(getAdminDb(), body.businessName ?? "", await getActor());
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    return NextResponse.json({ error: "تعذر حفظ الإعدادات" }, { status: 500 });
  }
}
