"use client";

import { doc, onSnapshot } from "firebase/firestore";
import { useEffect, useState } from "react";
import { getDb } from "@/lib/firebase/client";
import type { AppSettings } from "@/lib/types";

const DEFAULT_SETTINGS: AppSettings = {
  businessName: "نظام إدارة العاملات",
  timezone: "Asia/Bahrain",
  updatedAt: null,
  updatedBy: null,
};

export function useSettings() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onSnapshot(doc(getDb(), "settings", "app"), (snap) => {
      if (snap.exists()) setSettings(snap.data() as AppSettings);
      setLoading(false);
    });
    return unsub;
  }, []);

  return { settings, loading };
}
