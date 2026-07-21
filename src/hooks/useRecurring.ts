"use client";

import { collection, onSnapshot, query, where } from "firebase/firestore";
import { useEffect, useState } from "react";
import { getDb } from "@/lib/firebase/client";
import type { RecurringException, RecurringSchedule } from "@/lib/types";

export function useRecurringSchedules() {
  const [schedules, setSchedules] = useState<RecurringSchedule[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(collection(getDb(), "recurringSchedules"), where("status", "==", "active"));
    const unsub = onSnapshot(q, (snap) => {
      setSchedules(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as RecurringSchedule));
      setLoading(false);
    });
    return unsub;
  }, []);

  return { schedules, loading };
}

export function useAllRecurringSchedules() {
  const [schedules, setSchedules] = useState<RecurringSchedule[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onSnapshot(collection(getDb(), "recurringSchedules"), (snap) => {
      setSchedules(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as RecurringSchedule));
      setLoading(false);
    });
    return unsub;
  }, []);

  return { schedules, loading };
}

export function useRecurringExceptions() {
  const [exceptions, setExceptions] = useState<RecurringException[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onSnapshot(collection(getDb(), "recurringExceptions"), (snap) => {
      setExceptions(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as RecurringException));
      setLoading(false);
    });
    return unsub;
  }, []);

  return { exceptions, loading };
}
