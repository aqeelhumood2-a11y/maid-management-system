"use client";

import { usePolledFetch } from "./usePolledFetch";
import type { AppSettings } from "@/lib/types";

const DEFAULT_SETTINGS: AppSettings = {
  businessName: "نظام إدارة العاملات",
  timezone: "Asia/Bahrain",
  updatedAt: null,
  updatedBy: null,
};

export function useSettings() {
  const { data, loading } = usePolledFetch(async () => {
    const res = await fetch("/api/settings");
    const json = (await res.json()) as { settings?: AppSettings };
    return json.settings ?? DEFAULT_SETTINGS;
  }, []);

  return { settings: data ?? DEFAULT_SETTINGS, loading };
}
