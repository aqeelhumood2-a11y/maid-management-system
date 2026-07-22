"use client";

import { usePolledFetch, SLOW_INTERVAL_MS } from "./usePolledFetch";
import type { Area } from "@/lib/types";

export function useAreas() {
  const { data, loading } = usePolledFetch(
    async () => {
      const res = await fetch("/api/areas");
      if (!res.ok) throw new Error("تعذر تحميل المناطق");
      const json = (await res.json()) as { areas?: Area[] };
      return json.areas ?? [];
    },
    [],
    SLOW_INTERVAL_MS
  );

  return { areas: data ?? [], loading };
}
