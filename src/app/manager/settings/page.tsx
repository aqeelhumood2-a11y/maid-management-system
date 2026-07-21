"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { TextInput } from "@/components/ui/Field";
import { Badge, ErrorBanner, Spinner, SuccessBanner } from "@/components/ui/Feedback";
import { useAreas } from "@/hooks/useAreas";
import { useSettings } from "@/hooks/useSettings";
import { createArea, setAreaActive, updateArea } from "@/lib/areas";
import { updateSettings } from "@/lib/settings";
import type { Area } from "@/lib/types";

type Tab = "general" | "areas";

export default function SettingsPage() {
  const [tab, setTab] = useState<Tab>("general");

  return (
    <div className="flex flex-1 flex-col gap-4">
      <h1 className="text-xl font-bold text-slate-900">الإعدادات</h1>
      <div className="flex gap-2 border-b border-slate-200">
        {(
          [
            ["general", "عام"],
            ["areas", "المناطق"],
          ] as [Tab, string][]
        ).map(([value, label]) => (
          <button
            key={value}
            onClick={() => setTab(value)}
            className={`border-b-2 px-4 py-2 text-sm font-medium ${
              tab === value ? "border-emerald-600 text-emerald-700" : "border-transparent text-slate-500"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "general" && <GeneralTab />}
      {tab === "areas" && <AreasTab />}
    </div>
  );
}

function GeneralTab() {
  const { settings, loading } = useSettings();
  const [businessName, setBusinessName] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- seed the editable field once the settings doc first loads
    if (!loading) setBusinessName(settings.businessName);
  }, [loading, settings.businessName]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!businessName.trim()) return setError("أدخل اسم النظام");
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      await updateSettings(businessName.trim());
      setSuccess("تم حفظ الإعدادات");
    } catch {
      setError("تعذر حفظ الإعدادات");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <Spinner />;

  return (
    <form onSubmit={handleSubmit} className="max-w-md space-y-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
      <ErrorBanner message={error} />
      <SuccessBanner message={success} />
      <TextInput label="اسم النظام" required value={businessName} onChange={(e) => setBusinessName(e.target.value)} />
      <TextInput label="المنطقة الزمنية" value="Asia/Bahrain" disabled />
      <Button type="submit" loading={saving}>
        حفظ
      </Button>
    </form>
  );
}

function AreasTab() {
  const { areas, loading } = useAreas();
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<Area | null>(null);
  const [editName, setEditName] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleAdd(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError("أدخل اسم المنطقة");
    setSaving(true);
    setError("");
    try {
      await createArea(name.trim());
      setName("");
    } catch {
      setError("تعذر إضافة المنطقة");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <form onSubmit={handleAdd} className="flex gap-2 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <div className="flex-1">
          <TextInput label="منطقة جديدة" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="self-end">
          <Button type="submit" loading={saving}>
            إضافة
          </Button>
        </div>
      </form>
      <ErrorBanner message={error} />

      {loading ? (
        <Spinner />
      ) : (
        <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
          <ul className="divide-y divide-slate-100">
            {areas.map((a) =>
              editing?.id === a.id ? (
                <li key={a.id} className="flex items-center gap-2 px-4 py-3">
                  <div className="flex-1">
                    <TextInput label="" value={editName} onChange={(e) => setEditName(e.target.value)} />
                  </div>
                  <Button
                    size="sm"
                    onClick={async () => {
                      if (!editName.trim()) return;
                      await updateArea(a.id, editName.trim());
                      setEditing(null);
                    }}
                  >
                    حفظ
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => setEditing(null)}>
                    إلغاء
                  </Button>
                </li>
              ) : (
                <li key={a.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <span className="font-medium text-slate-900">{a.name}</span>
                  <div className="flex items-center gap-2">
                    <Badge color={a.active ? "green" : "gray"}>{a.active ? "نشطة" : "موقوفة"}</Badge>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        setEditing(a);
                        setEditName(a.name);
                      }}
                    >
                      تعديل
                    </Button>
                    <Button
                      size="sm"
                      variant={a.active ? "danger" : "primary"}
                      onClick={() => setAreaActive(a.id, !a.active)}
                    >
                      {a.active ? "إيقاف" : "تفعيل"}
                    </Button>
                  </div>
                </li>
              )
            )}
            {areas.length === 0 && (
              <li className="px-4 py-8 text-center text-sm text-slate-500">لا يوجد مناطق مضافة بعد</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
