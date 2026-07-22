"use client";

import { usePolledFetch, SLOW_INTERVAL_MS } from "./usePolledFetch";
import type { RecurringException, RecurringSchedule } from "@/lib/types";

export function useRecurringSchedules() {
  const { data, loading } = usePolledFetch(
    async () => {
      const res = await fetch("/api/recurring");
      if (!res.ok) throw new Error("تعذر تحميل الجدول المتكرر");
      const json = (await res.json()) as { schedules?: RecurringSchedule[] };
      return json.schedules ?? [];
    },
    [],
    SLOW_INTERVAL_MS
  );

  return { schedules: data ?? [], loading };
}

export function useRecurringExceptions() {
  const { data, loading } = usePolledFetch(
    async () => {
      const res = await fetch("/api/recurring/exceptions");
      if (!res.ok) throw new Error("تعذر تحميل الاستثناءات");
      const json = (await res.json()) as { exceptions?: RecurringException[] };
      return json.exceptions ?? [];
    },
    [],
    SLOW_INTERVAL_MS
  );

  return { exceptions: data ?? [], loading };
}
