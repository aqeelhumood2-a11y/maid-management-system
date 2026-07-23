"use client";

import { usePolledFetch, SLOW_INTERVAL_MS } from "./usePolledFetch";
import type { Worker } from "@/lib/types";

export function useWorkers() {
  const { data, loading, refetch } = usePolledFetch(
    async () => {
      const res = await fetch("/api/workers");
      if (!res.ok) throw new Error("تعذر تحميل العاملات");
      const json = (await res.json()) as { workers?: Worker[] };
      return json.workers ?? [];
    },
    [],
    SLOW_INTERVAL_MS
  );

  return { workers: data ?? [], loading, refetch };
}
