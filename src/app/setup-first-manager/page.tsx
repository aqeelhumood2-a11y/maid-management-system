import { getAdminDb } from "@/lib/firebase/admin";
import { isFirstManagerSetupLocked } from "@/lib/server/setupService";
import { SetupFirstManagerForm } from "./SetupFirstManagerForm";

export const dynamic = "force-dynamic";

export default async function SetupFirstManagerPage() {
  const locked = await isFirstManagerSetupLocked(getAdminDb());

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

        {locked ? (
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
        ) : (
          <SetupFirstManagerForm />
        )}
      </div>
    </div>
  );
}
