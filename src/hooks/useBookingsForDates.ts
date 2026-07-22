"use client";

import { usePolledFetch } from "./usePolledFetch";
import type { Booking } from "@/lib/types";

/** Polled active bookings for a bounded set of dates (matches Firestore `in`'s 30-item cap). */
export function useBookingsForDates(dates: string[]) {
  const key = dates.join(",");

  const { data, loading } = usePolledFetch(async () => {
    if (dates.length === 0) return [] as Booking[];
    const res = await fetch(`/api/bookings?dates=${encodeURIComponent(key)}`);
    if (!res.ok) throw new Error("تعذر تحميل الحجوزات");
    const json = (await res.json()) as { bookings?: Booking[] };
    return json.bookings ?? [];
  }, [key]);

  return { bookings: data ?? [], loading };
}
