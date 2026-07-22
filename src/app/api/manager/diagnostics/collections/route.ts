import { NextResponse } from "next/server";
import { isManagerSession } from "@/lib/auth/server";
import { getAdminDb } from "@/lib/firebase/admin";

/**
 * TEMPORARY, manager-only, read-only diagnostic — added to investigate why
 * production stopped showing existing workers/bookings/recurring
 * schedules/route orders after recent deploys, from a phone with no
 * DevTools access. Delete this route once that investigation is closed.
 *
 * Uses Firestore's count() aggregation exclusively — never fetches actual
 * documents, so nothing here can leak a name, phone number, or any other
 * customer/worker detail, and the cost is a handful of cheap aggregation
 * reads regardless of how large a collection is (unlike a real document
 * fetch, which is exactly the class of read this whole investigation started
 * over — this endpoint is deliberately built to not repeat that mistake,
 * even as a one-off).
 *
 * Reports, per collection: the raw document count vs. the count the app's
 * actual production query returns. If those numbers differ, the gap is
 * documents Firestore is silently excluding from that query — the classic
 * cause being a where()/orderBy() field that some existing documents don't
 * have a value for. Also reports the exact Firebase project ID this
 * server process is actually connected to, read from the same env vars
 * src/lib/firebase/admin.ts uses, so a wrong-project misconfiguration is
 * directly visible without needing Vercel dashboard access.
 */

function readEnv(...names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return undefined;
}

export async function GET() {
  if (!(await isManagerSession())) {
    return NextResponse.json({ error: "هذا الإجراء متاح للمدير فقط" }, { status: 401 });
  }

  const db = getAdminDb();

  const [
    workersRaw,
    workersOrderedByName,
    bookingsRaw,
    bookingsActive,
    recurringRaw,
    recurringActive,
    exceptionsRaw,
    routeOrdersRaw,
    settingsRaw,
    activityLogsRaw,
    slotsRaw,
  ] = await Promise.all([
    db.collection("workers").count().get(),
    db.collection("workers").orderBy("name").count().get(),
    db.collection("bookings").count().get(),
    db.collection("bookings").where("status", "==", "active").count().get(),
    db.collection("recurringSchedules").count().get(),
    db.collection("recurringSchedules").where("status", "==", "active").count().get(),
    db.collection("recurringExceptions").count().get(),
    db.collection("routeOrders").count().get(),
    db.collection("settings").count().get(),
    db.collection("activityLogs").count().get(),
    db.collection("slots").count().get(),
  ]);

  const projectId =
    readEnv("FIREBASE_ADMIN_PROJECT_ID", "FIREBASE_PROJECT_ID") ||
    (process.env.FIRESTORE_EMULATOR_HOST ? "(emulator — no project env var set, defaults apply)" : "(none set — Admin SDK init would be failing)");

  return NextResponse.json({
    projectId,
    usingEmulator: Boolean(process.env.FIRESTORE_EMULATOR_HOST),
    collections: {
      workers: {
        rawCount: workersRaw.data().count,
        appQueryCount: workersOrderedByName.data().count,
        appQuery: 'collection("workers").orderBy("name")',
        note:
          workersRaw.data().count !== workersOrderedByName.data().count
            ? "MISMATCH: some worker documents are missing a usable 'name' field and are being silently excluded from every screen that lists workers."
            : "matches — no documents are being excluded by the app's actual query.",
      },
      bookings: {
        rawCount: bookingsRaw.data().count,
        appQueryCount: bookingsActive.data().count,
        appQuery: 'collection("bookings").where("status","==","active")',
        note:
          bookingsRaw.data().count !== bookingsActive.data().count
            ? `${bookingsRaw.data().count - bookingsActive.data().count} booking document(s) are not status=="active" (either cancelled, or missing a status field) and are excluded from the schedule/route views by design.`
            : "matches.",
      },
      recurringSchedules: {
        rawCount: recurringRaw.data().count,
        appQueryCount: recurringActive.data().count,
        appQuery: 'collection("recurringSchedules").where("status","==","active")',
        note:
          recurringRaw.data().count !== recurringActive.data().count
            ? `${recurringRaw.data().count - recurringActive.data().count} recurring schedule document(s) are not status=="active" and are excluded by design.`
            : "matches.",
      },
      recurringExceptions: { rawCount: exceptionsRaw.data().count, appQuery: 'collection("recurringExceptions") — no filter' },
      routeOrders: { rawCount: routeOrdersRaw.data().count, appQuery: 'collection("routeOrders") — read by doc id, not listed' },
      settings: { rawCount: settingsRaw.data().count },
      activityLogs: { rawCount: activityLogsRaw.data().count },
      slots: { rawCount: slotsRaw.data().count },
    },
  });
}
