"use client";

import { usePolledFetch } from "./usePolledFetch";
import type { Area } from "@/lib/types";

export function useAreas() {
  const { data, loading } = usePolledFetch(async () => {
    const res = await fetch("/api/areas");
    const json = (await res.json()) as { areas?: Area[] };
    return json.areas ?? [];
  }, []);

  return { areas: data ?? [], loading };
}
