"use client";

import { useEffect, useRef, useState, type DependencyList } from "react";

const DEFAULT_INTERVAL_MS = 4000;

/**
 * Replaces Firestore's onSnapshot real-time listeners now that there is no
 * more Firebase Authentication to gate direct client reads with — every
 * read goes through a server API route backed by the Admin SDK instead (see
 * README's "Data access model" section). Polling on a short interval keeps
 * the schedule feeling live without ever exposing Firestore to the browser.
 */
export function usePolledFetch<T>(
  fetchFn: () => Promise<T>,
  deps: DependencyList,
  intervalMs: number = DEFAULT_INTERVAL_MS
): { data: T | undefined; loading: boolean } {
  const [data, setData] = useState<T | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const fetchRef = useRef(fetchFn);
  useEffect(() => {
    fetchRef.current = fetchFn;
  });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const result = await fetchRef.current();
        if (!cancelled) setData(result);
      } catch {
        // Keep showing the last known-good data on a transient network error.
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    const timer = setInterval(load, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, loading };
}
