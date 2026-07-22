"use client";

import { useEffect, useRef, useState, type DependencyList } from "react";

/**
 * Every page mounts several of these hooks at once (workers, bookings,
 * recurring schedules, exceptions, route order), each independently
 * re-reading its whole collection on every tick — that read volume is what
 * exhausts the Firestore free-tier daily quota if the interval is too
 * aggressive. 20s keeps the schedule feeling live for a booking/coordination
 * tool while cutting read volume ~5x versus the old 4s interval.
 */
const DEFAULT_INTERVAL_MS = 20000;

/**
 * For data that rarely changes during a working session (worker roster,
 * areas, business settings, recurring schedule definitions) — refreshing it
 * every 20s like live booking data buys nothing but extra reads. Pass this
 * as the interval override for hooks backing that kind of data.
 */
export const SLOW_INTERVAL_MS = 60000;

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

    // A background tab (staff leaving the schedule open all day) must not
    // keep burning read quota for a screen nobody is looking at — pause the
    // interval entirely while hidden, and refresh immediately on return.
    let timer: ReturnType<typeof setInterval> | null = null;
    function startTimer() {
      if (timer === null) timer = setInterval(load, intervalMs);
    }
    function stopTimer() {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    }
    function onVisibilityChange() {
      if (document.hidden) {
        stopTimer();
      } else {
        load();
        startTimer();
      }
    }

    if (typeof document !== "undefined" && !document.hidden) startTimer();
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelled = true;
      stopTimer();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, loading };
}
