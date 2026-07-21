"use client";

import { useState } from "react";
import { SelectInput } from "@/components/ui/Field";
import { EmptyState, Spinner } from "@/components/ui/Feedback";
import { usePolledFetch } from "@/hooks/usePolledFetch";
import { formatTimestampAr } from "@/lib/date";
import type { ActivityActionType, ActivityLog } from "@/lib/types";

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
  settings_updated: "تحديث الإعدادات",
};

export default function ActivityPage() {
  const [type, setType] = useState<"" | ActivityActionType>("");

  const { data, loading } = usePolledFetch(async () => {
    const url = type ? `/api/activity?type=${encodeURIComponent(type)}` : "/api/activity";
    const res = await fetch(url);
    const json = (await res.json()) as { logs?: ActivityLog[] };
    return json.logs ?? [];
  }, [type]);
  const logs = data ?? [];

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
                    {log.createdAt ? formatTimestampAr(new Date(log.createdAt._seconds * 1000)) : ""}
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
