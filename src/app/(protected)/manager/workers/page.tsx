"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { TextInput } from "@/components/ui/Field";
import { Badge, ErrorBanner, Spinner } from "@/components/ui/Feedback";
import { useAuth } from "@/context/AuthContext";
import { useWorkers } from "@/hooks/useWorkers";
import { getDb } from "@/lib/firebase/client";
import { createWorker, setWorkerActive, updateWorker } from "@/lib/workers";
import type { Worker } from "@/lib/types";

export default function WorkersPage() {
  const { actingUser } = useAuth();
  const { workers, loading } = useWorkers();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Worker | null>(null);
  const [toggling, setToggling] = useState<Worker | null>(null);

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-900">إدارة العاملات</h1>
        <Button onClick={() => setFormOpen(true)}>+ إضافة عاملة</Button>
      </div>

      {loading ? (
        <Spinner />
      ) : (
        <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
          <ul className="divide-y divide-slate-100">
            {workers.map((w) => (
              <li key={w.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div>
                  <p className="font-medium text-slate-900">{w.name}</p>
                  <p className="text-sm text-slate-500" dir="ltr">
                    {w.phone}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge color={w.active ? "green" : "gray"}>{w.active ? "نشطة" : "موقوفة"}</Badge>
                  <Button size="sm" variant="secondary" onClick={() => setEditing(w)}>
                    تعديل
                  </Button>
                  <Button size="sm" variant={w.active ? "danger" : "primary"} onClick={() => setToggling(w)}>
                    {w.active ? "إيقاف" : "تفعيل"}
                  </Button>
                </div>
              </li>
            ))}
            {workers.length === 0 && (
              <li className="px-4 py-8 text-center text-sm text-slate-500">لا يوجد عاملات مسجلات بعد</li>
            )}
          </ul>
        </div>
      )}

      <WorkerFormModal open={formOpen} onClose={() => setFormOpen(false)} actingUser={actingUser} />
      {editing && (
        <WorkerFormModal
          open
          worker={editing}
          onClose={() => setEditing(null)}
          actingUser={actingUser}
        />
      )}

      <ConfirmDialog
        open={!!toggling}
        onClose={() => setToggling(null)}
        title={toggling?.active ? "إيقاف العاملة" : "تفعيل العاملة"}
        message={
          toggling?.active
            ? `هل تريد إيقاف "${toggling?.name}"؟ لن تظهر في الحجوزات الجديدة، وتبقى بياناتها التاريخية محفوظة.`
            : `هل تريد إعادة تفعيل "${toggling?.name}"؟`
        }
        confirmLabel={toggling?.active ? "إيقاف" : "تفعيل"}
        danger={!!toggling?.active}
        onConfirm={async () => {
          if (!toggling) return;
          await setWorkerActive(
            getDb(),
            toggling.id,
            { name: toggling.name, phone: toggling.phone, active: toggling.active },
            !toggling.active,
            actingUser
          );
          setToggling(null);
        }}
      />
    </div>
  );
}

function WorkerFormModal({
  open,
  onClose,
  worker,
  actingUser,
}: {
  open: boolean;
  onClose: () => void;
  worker?: Worker;
  actingUser: { uid: string; email: string; name: string };
}) {
  const [name, setName] = useState(worker?.name ?? "");
  const [phone, setPhone] = useState(worker?.phone ?? "");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError("أدخل اسم العاملة");
      return;
    }
    setLoading(true);
    setError("");
    try {
      if (worker) {
        await updateWorker(
          getDb(),
          worker.id,
          { name: worker.name, phone: worker.phone, active: worker.active },
          { name: name.trim(), phone: phone.trim() },
          actingUser
        );
      } else {
        await createWorker(getDb(), { name: name.trim(), phone: phone.trim() }, actingUser);
      }
      onClose();
    } catch {
      setError("تعذر حفظ البيانات");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={worker ? "تعديل بيانات العاملة" : "إضافة عاملة جديدة"}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <ErrorBanner message={error} />
        <TextInput label="اسم العاملة" required value={name} onChange={(e) => setName(e.target.value)} />
        <TextInput label="رقم الهاتف" type="tel" dir="ltr" className="text-right" value={phone} onChange={(e) => setPhone(e.target.value)} />
        <Button type="submit" fullWidth loading={loading}>
          حفظ
        </Button>
      </form>
    </Modal>
  );
}
