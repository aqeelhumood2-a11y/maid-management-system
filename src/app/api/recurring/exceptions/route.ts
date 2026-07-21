import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import type { RecurringException } from "@/lib/types";

/** Read is open to everyone — needed to resolve schedule-grid availability correctly. */
export async function GET() {
  const snap = await getAdminDb().collection("recurringExceptions").get();
  const exceptions = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as RecurringException);
  return NextResponse.json({ exceptions });
}
