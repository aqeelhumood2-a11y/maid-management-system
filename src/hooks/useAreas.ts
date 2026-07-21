"use client";

import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { useEffect, useState } from "react";
import { getDb } from "@/lib/firebase/client";
import type { Area } from "@/lib/types";

export function useAreas() {
  const [areas, setAreas] = useState<Area[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(collection(getDb(), "areas"), orderBy("name"));
    const unsub = onSnapshot(q, (snap) => {
      setAreas(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Area));
      setLoading(false);
    });
    return unsub;
  }, []);

  return { areas, loading };
}
