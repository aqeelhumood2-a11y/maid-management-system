import { NextResponse } from "next/server";
import { getActor, isManagerSession } from "@/lib/auth/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { changeManagerPasswordServer } from "@/lib/server/managerAuth";
import { ServiceError } from "@/lib/server/errors";

/**
 * Manager Dashboard → Site Settings → Change Password. Verifies the current
 * password server-side before accepting the new one — never trusts that the
 * caller is who they claim just because they hold a valid session cookie
 * (the session proves "logged in as manager", not "knows the password").
 */
export async function PATCH(request: Request) {
  if (!(await isManagerSession())) {
    return NextResponse.json({ error: "هذا الإجراء متاح للمدير فقط" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    currentPassword?: string;
    newPassword?: string;
  };

  try {
    await changeManagerPasswordServer(
      getAdminDb(),
      body.currentPassword ?? "",
      body.newPassword ?? "",
      await getActor()
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    return NextResponse.json({ error: "تعذر تغيير كلمة المرور" }, { status: 500 });
  }
}
