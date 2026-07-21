"use client";

import { usePolledFetch } from "./usePolledFetch";
import type { Worker } from "@/lib/types";

export function useWorkers() {
  const { data, loading } = usePolledFetch(async () => {
    const res = await fetch("/api/workers");
    const json = (await res.json()) as { workers?: Worker[] };
    return json.workers ?? [];
  }, []);

  return { workers: data ?? [], loading };
}
