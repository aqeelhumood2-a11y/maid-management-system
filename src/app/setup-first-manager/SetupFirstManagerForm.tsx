"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { TextInput } from "@/components/ui/Field";
import { ErrorBanner } from "@/components/ui/Feedback";

export function SetupFirstManagerForm() {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ uid: string } | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");

    if (password.length < 8) {
      setError("كلمة المرور يجب ألا تقل عن 8 أحرف");
      return;
    }
    if (password !== confirmPassword) {
      setError("كلمتا المرور غير متطابقتين");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/setup-first-manager", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; uid?: string };
      if (!res.ok) {
        setError(data.error || "تعذر إكمال الإعداد الأولي");
        return;
      }
      setResult({ uid: data.uid ?? "" });
    } catch {
      setError("تعذر الاتصال بالخادم، حاول مرة أخرى");
    } finally {
      setLoading(false);
    }
  }

  if (result) {
    return (
      <div className="space-y-4 rounded-2xl bg-white p-6 text-center shadow-sm ring-1 ring-slate-200">
        <div className="text-3xl">✅</div>
        <p className="font-medium text-slate-800">تم إنشاء حساب المدير بنجاح</p>
        <p className="text-sm text-slate-500" dir="ltr">
          uid: {result.uid}
        </p>
        <p className="text-sm text-slate-500">
          يمكنك الآن تسجيل الدخول باستخدام aqeelhumood2@gmail.com وكلمة المرور التي أدخلتها.
        </p>
        <a
          href="/login"
          className="inline-block rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
        >
          تسجيل الدخول الآن
        </a>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-4 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200"
    >
      <ErrorBanner message={error} />

      <div className="rounded-xl bg-slate-50 p-3 text-sm text-slate-600">
        سيتم إنشاء حساب مدير للبريد الإلكتروني:
        <br />
        <span dir="ltr" className="font-medium text-slate-800">
          aqeelhumood2@gmail.com
        </span>
      </div>

      <TextInput
        label="كلمة المرور الجديدة"
        type="password"
        required
        minLength={8}
        dir="ltr"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        autoComplete="new-password"
      />
      <TextInput
        label="تأكيد كلمة المرور"
        type="password"
        required
        minLength={8}
        dir="ltr"
        value={confirmPassword}
        onChange={(e) => setConfirmPassword(e.target.value)}
        autoComplete="new-password"
      />

      <Button type="submit" fullWidth size="lg" loading={loading}>
        إنشاء حساب المدير
      </Button>
    </form>
  );
}
