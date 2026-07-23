"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { TextInput } from "@/components/ui/Field";
import { Badge, ErrorBanner, SuccessBanner, Spinner } from "@/components/ui/Feedback";
import { useWorkers } from "@/hooks/useWorkers";
import {
  createWorker,
  deleteWorker,
  getWorkerImpact,
  setWorkerActive,
  updateWorker,
  type WorkerImpact,
} from "@/lib/workers";
import type { Worker } from "@/lib/types";

export default function WorkersPage() {
  const { workers, loading, refetch } = useWorkers();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Worker | null>(null);
  const [toggling, setToggling] = useState<Worker | null>(null);
  const [deleting, setDeleting] = useState<Worker | null>(null);
  const [successMessage, setSuccessMessage] = useState("");

  useEffect(() => {
    if (!successMessage) return;
    const timer = setTimeout(() => setSuccessMessage(""), 5000);
    return () => clearTimeout(timer);
  }, [successMessage]);

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-900">إدارة العاملات</h1>
        <Button onClick={() => setFormOpen(true)}>+ إضافة عاملة</Button>
      </div>

      <SuccessBanner message={successMessage} />

      {loading ? (
        <Spinner />
      ) : (
        <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
          <ul className="divide-y divide-slate-100">
            {workers.map((w) => (
              <li key={w.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
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
                  <Button size="sm" variant="danger" onClick={() => setDeleting(w)}>
                    حذف العاملة
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

      <WorkerFormModal open={formOpen} onClose={() => setFormOpen(false)} />
      {editing && <WorkerFormModal open worker={editing} onClose={() => setEditing(null)} />}

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
          await setWorkerActive(toggling.id, !toggling.active);
          setToggling(null);
        }}
      />

      {deleting && (
        <DeleteWorkerFlow
          worker={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={async (name) => {
            setDeleting(null);
            await refetch();
            setSuccessMessage(`تم حذف العاملة "${name}" نهائيًا بنجاح`);
          }}
        />
      )}
    </div>
  );
}

/**
 * Two-step destructive confirmation, kept separate from ConfirmDialog since
 * it needs a future-commitments warning and an inline error state that the
 * shared single-message ConfirmDialog doesn't support. Deletion here is
 * PERMANENT — the worker document is removed from Firestore entirely (see
 * deleteWorkerServer). Historical bookings/recurring schedules keep their
 * own denormalized worker name and are never touched; the worker is simply
 * gone from every list that reads the workers collection going forward.
 */
function DeleteWorkerFlow({
  worker,
  onClose,
  onDeleted,
}: {
  worker: Worker;
  onClose: () => void;
  onDeleted: (name: string) => void;
}) {
  const [step, setStep] = useState<1 | 2>(1);
  const [impact, setImpact] = useState<WorkerImpact | null>(null);
  const [impactLoading, setImpactLoading] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    getWorkerImpact(worker.id)
      .then((result) => {
        if (!cancelled) setImpact(result);
      })
      .catch(() => {
        // Non-critical: if the check fails, proceed without the warning rather than blocking deletion.
      })
      .finally(() => {
        if (!cancelled) setImpactLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [worker.id]);

  const hasFutureCommitments = !!impact && (impact.futureBookings > 0 || impact.activeRecurringSchedules > 0);

  async function handleConfirmDelete() {
    setLoading(true);
    setError("");
    try {
      await deleteWorker(worker.id);
      onDeleted(worker.name);
    } catch {
      setError("تعذر حذف العاملة، حاول مرة أخرى");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={step === 1 ? "حذف العاملة نهائيًا" : "تأكيد الحذف النهائي"}>
      <div className="space-y-4">
        {step === 1 ? (
          <>
            <p className="text-slate-700">{`هل أنت متأكد من حذف العاملة ${worker.name} نهائيًا؟`}</p>
            <p className="text-sm text-slate-500">
              سيتم حذف بيانات العاملة نهائيًا من النظام ولن تظهر في أي قائمة اختيار جديدة. تبقى حجوزاتها وسجلاتها
              التاريخية محفوظة باسمها كما هي.
            </p>
            {impactLoading && (
              <p className="text-sm text-slate-500">جارٍ التحقق من الحجوزات والجداول المستقبلية...</p>
            )}
            {!impactLoading && hasFutureCommitments && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                تنبيه: لدى هذه العاملة {impact!.futureBookings} حجز مستقبلي و{impact!.activeRecurringSchedules} جدول
                متكرر نشط. لن يتم حذف أو إلغاء هذه الحجوزات أو الجداول تلقائياً، لكنها ستبقى بعاملة محذوفة ويجب على
                المدير إعادة تعيينها يدوياً.
              </div>
            )}
          </>
        ) : (
          <p className="text-slate-700">سيتم حذف العاملة نهائيًا ولا يمكن التراجع. هل تريد المتابعة؟</p>
        )}
        <ErrorBanner message={error} />
        <div className="flex gap-3">
          <Button variant="secondary" fullWidth onClick={onClose} disabled={loading}>
            إلغاء
          </Button>
          <Button
            variant="danger"
            fullWidth
            loading={loading}
            disabled={step === 1 && impactLoading}
            onClick={step === 1 ? () => setStep(2) : handleConfirmDelete}
          >
            {step === 1 ? "متابعة" : "حذف نهائيًا"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function WorkerFormModal({
  open,
  onClose,
  worker,
}: {
  open: boolean;
  onClose: () => void;
  worker?: Worker;
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
        await updateWorker(worker.id, { name: name.trim(), phone: phone.trim() });
      } else {
        await createWorker({ name: name.trim(), phone: phone.trim() });
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
