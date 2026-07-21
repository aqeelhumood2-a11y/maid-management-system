"use client";

import { usePolledFetch } from "./usePolledFetch";
import type { RecurringException, RecurringSchedule } from "@/lib/types";

export function useRecurringSchedules() {
  const { data, loading } = usePolledFetch(async () => {
    const res = await fetch("/api/recurring");
    const json = (await res.json()) as { schedules?: RecurringSchedule[] };
    return json.schedules ?? [];
  }, []);

  return { schedules: data ?? [], loading };
}

export function useRecurringExceptions() {
  const { data, loading } = usePolledFetch(async () => {
    const res = await fetch("/api/recurring/exceptions");
    const json = (await res.json()) as { exceptions?: RecurringException[] };
    return json.exceptions ?? [];
  }, []);

  return { exceptions: data ?? [], loading };
}
