"use client";

import { collection, onSnapshot, query, where } from "firebase/firestore";
import { useEffect, useState } from "react";
import { getDb } from "@/lib/firebase/client";
import type { Booking } from "@/lib/types";

/** Real-time active bookings for a bounded set of dates (Firestore `in` supports up to 30). */
export function useBookingsForDates(dates: string[]) {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const key = dates.join(",");

  useEffect(() => {
    if (dates.length === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- resetting derived state when the query key changes to an empty selection
      setBookings([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const q = query(
      collection(getDb(), "bookings"),
      where("date", "in", dates),
      where("status", "==", "active")
    );
    const unsub = onSnapshot(q, (snap) => {
      setBookings(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Booking));
      setLoading(false);
    });
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { bookings, loading };
}
