import { getAdminDb } from "@/lib/firebase/admin";
import { isFirstManagerSetupLocked } from "@/lib/server/setupService";
import { SetupFirstManagerForm } from "./SetupFirstManagerForm";

export const dynamic = "force-dynamic";

type PageState =
  | { kind: "available" }
  | { kind: "locked" }
  | { kind: "misconfigured" };

/**
 * Admin SDK failures (missing/invalid FIREBASE_ADMIN_* env vars, an
 * unreachable Firestore, etc.) must never crash this Server Component into
 * Next's generic error page — this page exists specifically so someone with
 * no terminal access can bootstrap the system, so it has to be able to tell
 * them what's actually wrong instead of a blank "server error". The real
 * error is still logged server-side (visible in Vercel's function logs) for
 * whoever has deploy access to diagnose.
 */
async function resolvePageState(): Promise<PageState> {
  try {
    const locked = await isFirstManagerSetupLocked(getAdminDb());
    return locked ? { kind: "locked" } : { kind: "available" };
  } catch (err) {
    console.error("[setup-first-manager] Failed to check setup state:", err);
    return { kind: "misconfigured" };
  }
}

export default async function SetupFirstManagerPage() {
  const state = await resolvePageState();

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-5 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-600 text-2xl text-white">
            🔐
          </div>
          <h1 className="text-xl font-bold text-slate-900">إعداد أول حساب مدير</h1>
          <p className="mt-1 text-sm text-slate-500">صفحة إعداد أولي لمرة واحدة فقط</p>
        </div>

        {state.kind === "misconfigured" && (
          <div className="space-y-3 rounded-2xl bg-white p-6 text-center shadow-sm ring-1 ring-slate-200">
            <p className="font-medium text-red-700">تعذر الاتصال بالخادم</p>
            <p className="text-sm text-slate-500">
              لم يتم إعداد بيانات اعتماد Firebase Admin بشكل صحيح على الخادم. تأكد من ضبط متغيرات
              البيئة التالية في Vercel ثم أعد النشر:
            </p>
            <p dir="ltr" className="rounded-lg bg-slate-50 p-3 text-left text-xs text-slate-600">
              FIREBASE_ADMIN_PROJECT_ID
              <br />
              FIREBASE_ADMIN_CLIENT_EMAIL
              <br />
              FIREBASE_ADMIN_PRIVATE_KEY
            </p>
          </div>
        )}

        {state.kind === "locked" && (
          <div className="space-y-3 rounded-2xl bg-white p-6 text-center shadow-sm ring-1 ring-slate-200">
            <p className="font-medium text-slate-800">تم إعداد النظام مسبقًا</p>
            <p className="text-sm text-slate-500">
              هذه الصفحة لم تعد متاحة لأن حساب المدير الأول تم إنشاؤه بالفعل.
            </p>
            <a
              href="/login"
              className="inline-block rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
            >
              الذهاب إلى تسجيل الدخول
            </a>
          </div>
        )}

        {state.kind === "available" && <SetupFirstManagerForm />}
      </div>
    </div>
  );
}
