"use client";

import { usePolledFetch, SLOW_INTERVAL_MS } from "./usePolledFetch";
import type { AppSettings } from "@/lib/types";

const DEFAULT_SETTINGS: AppSettings = {
  businessName: "نظام إدارة العاملات",
  timezone: "Asia/Bahrain",
  updatedAt: null,
  updatedBy: null,
};

export function useSettings() {
  const { data, loading } = usePolledFetch(
    async () => {
      const res = await fetch("/api/settings");
      if (!res.ok) throw new Error("تعذر تحميل الإعدادات");
      const json = (await res.json()) as { settings?: AppSettings };
      return json.settings ?? DEFAULT_SETTINGS;
    },
    [],
    SLOW_INTERVAL_MS
  );

  return { settings: data ?? DEFAULT_SETTINGS, loading };
}
