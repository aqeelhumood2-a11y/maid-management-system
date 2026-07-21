"use client";

import { collection, limit, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { useEffect, useState } from "react";
import { SelectInput } from "@/components/ui/Field";
import { EmptyState, Spinner } from "@/components/ui/Feedback";
import { formatTimestampAr } from "@/lib/date";
import { getDb } from "@/lib/firebase/client";
import type { ActivityActionType, ActivityLog } from "@/lib/types";
import type { Timestamp } from "firebase/firestore";

const TYPE_LABELS: Record<ActivityActionType, string> = {
  login: "تسجيل دخول",
  booking_created: "إنشاء حجز",
  booking_edited: "تعديل حجز",
  booking_cancelled: "إلغاء حجز",
  payment_marked_paid: "تسجيل دفع",
  worker_added: "إضافة عاملة",
  worker_edited: "تعديل بيانات عاملة",
  worker_activated: "تفعيل عاملة",
  worker_deactivated: "إيقاف عاملة",
  recurring_created: "إنشاء موعد متكرر",
  recurring_edited: "تعديل موعد متكرر",
  recurring_cancelled: "إلغاء موعد متكرر",
  area_added: "إضافة منطقة",
  area_edited: "تعديل منطقة",
  area_deactivated: "إيقاف منطقة",
  user_added: "إضافة مستخدم",
  user_edited: "تعديل مستخدم",
  settings_updated: "تحديث الإعدادات",
};

export default function ActivityPage() {
  const [type, setType] = useState<"" | ActivityActionType>("");
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- show the spinner immediately when the type filter changes
    setLoading(true);
    const base = collection(getDb(), "activityLogs");
    const q = type
      ? query(base, where("type", "==", type), orderBy("createdAt", "desc"), limit(200))
      : query(base, orderBy("createdAt", "desc"), limit(200));
    const unsub = onSnapshot(q, (snap) => {
      setLogs(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as ActivityLog));
      setLoading(false);
    });
    return unsub;
  }, [type]);

  return (
    <div className="flex flex-1 flex-col gap-4">
      <h1 className="text-xl font-bold text-slate-900">سجل النشاط</h1>

      <div className="max-w-xs rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <SelectInput label="نوع الإجراء" value={type} onChange={(e) => setType(e.target.value as "" | ActivityActionType)}>
          <option value="">جميع الإجراءات</option>
          {Object.entries(TYPE_LABELS).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </SelectInput>
      </div>

      {loading ? (
        <Spinner />
      ) : logs.length === 0 ? (
        <EmptyState message="لا يوجد سجل نشاط بعد" />
      ) : (
        <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
          <ul className="divide-y divide-slate-100">
            {logs.map((log) => (
              <li key={log.id} className="px-4 py-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-slate-900">{TYPE_LABELS[log.type] ?? log.type}</span>
                  <span className="text-xs text-slate-400">
                    {log.createdAt ? formatTimestampAr((log.createdAt as Timestamp).toDate()) : ""}
                  </span>
                </div>
                <p className="mt-0.5 text-sm text-slate-500">
                  بواسطة {log.actingName || log.actingEmail}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
