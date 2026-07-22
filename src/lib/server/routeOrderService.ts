import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { ServiceError } from "./errors";
import type { Actor } from "./bookingService";
import type { Shift } from "../types";

/**
 * The Daily Route's manually-arranged display order — one document per
 * (date, shift), so Morning and Evening ordering are always independent
 * documents that can never affect each other. Ordering is a list of worker
 * ids, not booking ids, so it's stable across a not-yet-materialized
 * recurring occurrence later becoming a concrete booking, and survives
 * refresh/reload since it's just another Firestore read.
 */

function requireManager(actor: Actor) {
  if (actor.role !== "manager") {
    throw new ServiceError("هذا الإجراء متاح للمدير فقط", "FORBIDDEN", 403);
  }
}

function routeOrderDocId(date: string, shift: Shift): string {
  return `${date}_${shift}`;
}

/** Open read — the employee Daily Route needs this to display in the manager's saved order. */
export async function getRouteOrderServer(db: Firestore, date: string, shift: Shift): Promise<string[]> {
  const snap = await db.collection("routeOrders").doc(routeOrderDocId(date, shift)).get();
  if (!snap.exists) return [];
  const data = snap.data() as { workerIds?: string[] };
  return Array.isArray(data.workerIds) ? data.workerIds : [];
}

/**
 * Manager only — persists the full manually-arranged order for one
 * date+shift in a single write. The caller sends the complete ordered list
 * of worker ids currently shown on that route; workers not in the route at
 * save time simply aren't included, and any new worker/booking that shows
 * up later is appended after the saved order until the manager reorders
 * again (see the sort applied on read in the Daily Route pages).
 */
export async function saveRouteOrderServer(
  db: Firestore,
  date: string,
  shift: Shift,
  workerIds: string[],
  actor: Actor
): Promise<void> {
  requireManager(actor);
  if (!Array.isArray(workerIds) || workerIds.some((id) => typeof id !== "string" || !id)) {
    throw new ServiceError("ترتيب غير صالح", "VALIDATION", 400);
  }

  const ref = db.collection("routeOrders").doc(routeOrderDocId(date, shift));
  const batch = db.batch();
  batch.set(ref, {
    date,
    shift,
    workerIds,
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: actor.uid,
  });
  const logRef = db.collection("activityLogs").doc();
  batch.set(logRef, {
    type: "route_order_updated",
    entityType: "routeOrder",
    entityId: ref.id,
    actingUid: actor.uid,
    actingEmail: actor.email,
    actingName: actor.name,
    before: null,
    after: { date, shift, workerIds },
    createdAt: FieldValue.serverTimestamp(),
  });
  await batch.commit();
}
