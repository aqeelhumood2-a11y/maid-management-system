import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { ServiceError } from "@/lib/server/errors";
import { completeFirstManagerSetup } from "@/lib/server/setupService";

interface SetupBody {
  secret?: string;
  password?: string;
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as SetupBody;

  try {
    const { uid } = await completeFirstManagerSetup(getAdminDb(), getAdminAuth(), {
      secret: body.secret ?? "",
      password: body.password ?? "",
    });
    return NextResponse.json({ ok: true, uid });
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    return NextResponse.json({ error: "تعذر إكمال الإعداد الأولي" }, { status: 500 });
  }
}
