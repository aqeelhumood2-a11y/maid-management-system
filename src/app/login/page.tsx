"use client";

import { signInWithEmailAndPassword } from "firebase/auth";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { TextInput } from "@/components/ui/Field";
import { ErrorBanner } from "@/components/ui/Feedback";
import { getFirebaseAuth } from "@/lib/firebase/client";

const AUTH_ERROR_MESSAGES: Record<string, string> = {
  "auth/invalid-email": "البريد الإلكتروني غير صالح",
  "auth/invalid-credential": "البريد الإلكتروني أو كلمة المرور غير صحيحة",
  "auth/user-disabled": "تم إيقاف هذا الحساب",
  "auth/too-many-requests": "محاولات كثيرة، حاول لاحقاً",
};

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const auth = getFirebaseAuth();
      const credential = await signInWithEmailAndPassword(auth, email.trim(), password);
      const idToken = await credential.user.getIdToken(true);

      const res = await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken }),
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        await auth.signOut();
        setError(data.error || "تعذر تسجيل الدخول");
        setLoading(false);
        return;
      }

      window.location.href = "/today";
    } catch (err) {
      const code = (err as { code?: string })?.code ?? "";
      setError(AUTH_ERROR_MESSAGES[code] || "تعذر تسجيل الدخول، حاول مرة أخرى");
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-5 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-600 text-2xl text-white">
            🏠
          </div>
          <h1 className="text-xl font-bold text-slate-900">نظام إدارة العاملات</h1>
          <p className="mt-1 text-sm text-slate-500">تسجيل الدخول للمتابعة</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
          <ErrorBanner message={error} />
          <TextInput
            label="البريد الإلكتروني"
            type="email"
            required
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            dir="ltr"
            className="text-right"
          />
          <TextInput
            label="كلمة المرور"
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            dir="ltr"
          />
          <Button type="submit" fullWidth size="lg" loading={loading}>
            تسجيل الدخول
          </Button>
        </form>
        <p className="mt-6 text-center text-xs text-slate-400">
          يتم إنشاء الحسابات وإدارتها من قبل المدير فقط
        </p>
      </div>
    </div>
  );
}
