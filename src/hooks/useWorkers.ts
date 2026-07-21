"use client";

import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { useEffect, useState } from "react";
import { getDb } from "@/lib/firebase/client";
import type { Worker } from "@/lib/types";

export function useWorkers() {
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(collection(getDb(), "workers"), orderBy("name"));
    const unsub = onSnapshot(q, (snap) => {
      setWorkers(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Worker));
      setLoading(false);
    });
    return unsub;
  }, []);

  return { workers, loading };
}
