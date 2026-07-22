"use client";

import { usePolledFetch } from "./usePolledFetch";
import { getRouteOrder } from "@/lib/routeOrder";
import type { Shift } from "@/lib/types";

/** Polled saved Daily Route order for one date+shift — Morning and Evening are always separate calls. */
export function useRouteOrder(date: string, shift: Shift) {
  const { data, loading } = usePolledFetch(async () => getRouteOrder(date, shift), [date, shift]);
  return { workerIds: data ?? [], loading };
}
