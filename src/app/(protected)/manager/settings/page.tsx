"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { SelectInput, TextInput } from "@/components/ui/Field";
import { Badge, ErrorBanner, Spinner, SuccessBanner } from "@/components/ui/Feedback";
import { useAuth } from "@/context/AuthContext";
import { useAreas } from "@/hooks/useAreas";
import { useSettings } from "@/hooks/useSettings";
import { createArea, setAreaActive, updateArea } from "@/lib/areas";
import { getDb } from "@/lib/firebase/client";
import { updateSettings } from "@/lib/settings";
import type { Area, Role } from "@/lib/types";

type Tab = "general" | "areas" | "users";

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
            ["users", "المستخدمون"],
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
      {tab === "users" && <UsersTab />}
    </div>
  );
}

function GeneralTab() {
  const { actingUser } = useAuth();
  const { settings, loading } = useSettings();
  const [businessName, setBusinessName] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- seed the editable field once the real-time settings doc first loads
    if (!loading) setBusinessName(settings.businessName);
  }, [loading, settings.businessName]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!businessName.trim()) return setError("أدخل اسم النظام");
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      await updateSettings(getDb(), businessName.trim(), actingUser);
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
  const { actingUser } = useAuth();
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
      await createArea(getDb(), name.trim(), actingUser);
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
                      await updateArea(getDb(), a.id, { name: a.name, active: a.active }, editName.trim(), actingUser);
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
                      onClick={() => setAreaActive(getDb(), a.id, { name: a.name, active: a.active }, !a.active, actingUser)}
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

interface ManagedUser {
  uid: string;
  email: string;
  name: string;
  role: Role;
  active: boolean;
}

function UsersTab() {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [error, setError] = useState("");

  async function loadUsers() {
    setLoading(true);
    const res = await fetch("/api/users");
    const data = await res.json();
    setUsers(data.users ?? []);
    setLoading(false);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load of the user list from the API on mount
    loadUsers();
  }, []);

  async function toggleActive(u: ManagedUser) {
    setError("");
    const res = await fetch(`/api/users/${u.uid}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !u.active }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "تعذر تنفيذ الإجراء");
      return;
    }
    loadUsers();
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setFormOpen(true)}>+ إضافة مستخدم</Button>
      </div>
      <ErrorBanner message={error} />

      {loading ? (
        <Spinner />
      ) : (
        <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
          <ul className="divide-y divide-slate-100">
            {users.map((u) => (
              <li key={u.uid} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div>
                  <p className="font-medium text-slate-900">{u.name}</p>
                  <p className="text-sm text-slate-500" dir="ltr">
                    {u.email}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge color="gray">{u.role === "manager" ? "مدير" : "موظف"}</Badge>
                  <Badge color={u.active ? "green" : "red"}>{u.active ? "نشط" : "موقوف"}</Badge>
                  <Button size="sm" variant={u.active ? "danger" : "primary"} onClick={() => toggleActive(u)}>
                    {u.active ? "إيقاف" : "تفعيل"}
                  </Button>
                </div>
              </li>
            ))}
            {users.length === 0 && (
              <li className="px-4 py-8 text-center text-sm text-slate-500">لا يوجد مستخدمون</li>
            )}
          </ul>
        </div>
      )}

      {formOpen && (
        <AddUserModal
          onClose={() => setFormOpen(false)}
          onCreated={() => {
            setFormOpen(false);
            loadUsers();
          }}
        />
      )}
    </div>
  );
}

function AddUserModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("employee");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password, role }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "تعذر إنشاء المستخدم");
        return;
      }
      onCreated();
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="إضافة مستخدم">
      <form onSubmit={handleSubmit} className="space-y-4">
        <ErrorBanner message={error} />
        <TextInput label="الاسم" required value={name} onChange={(e) => setName(e.target.value)} />
        <TextInput label="البريد الإلكتروني" type="email" dir="ltr" className="text-right" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <TextInput label="كلمة المرور" type="password" dir="ltr" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} />
        <SelectInput label="الصلاحية" value={role} onChange={(e) => setRole(e.target.value as Role)}>
          <option value="employee">موظف</option>
          <option value="manager">مدير</option>
        </SelectInput>
        <Button type="submit" fullWidth loading={loading}>
          إنشاء الحساب
        </Button>
      </form>
    </Modal>
  );
}
