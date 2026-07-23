import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { BAHRAIN_TZ } from "../date";
import { ServiceError } from "./errors";
import type { Actor } from "./bookingService";

/**
 * Areas, workers and settings used to be written directly from the browser
 * under Firestore Security Rules keyed on Firebase Auth custom claims. With
 * Firebase Authentication removed entirely, Firestore rules have nothing
 * left to authorize against, so — exactly like bookings/recurring schedules
 * already were — every write here happens server-side under the Admin SDK,
 * called only from manager-gated API routes.
 */

function requireManager(actor: Actor) {
  if (actor.role !== "manager") {
    throw new ServiceError("هذا الإجراء متاح للمدير فقط", "FORBIDDEN", 403);
  }
}

function requireNonEmptyString(value: unknown, message: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ServiceError(message, "VALIDATION", 400);
  }
  return value.trim();
}

function logActivity(
  db: Firestore,
  batch: FirebaseFirestore.WriteBatch,
  entry: {
    type: string;
    entityType: string;
    entityId: string;
    actor: Actor;
    before: Record<string, unknown> | null;
    after: Record<string, unknown> | null;
  }
) {
  const ref = db.collection("activityLogs").doc();
  batch.set(ref, {
    type: entry.type,
    entityType: entry.entityType,
    entityId: entry.entityId,
    actingUid: entry.actor.uid,
    actingEmail: entry.actor.email,
    actingName: entry.actor.name,
    before: entry.before,
    after: entry.after,
    createdAt: FieldValue.serverTimestamp(),
  });
}

// ---------------------------------------------------------------------
// Areas
// ---------------------------------------------------------------------

export async function createAreaServer(db: Firestore, name: string, actor: Actor): Promise<string> {
  requireManager(actor);
  const cleanName = requireNonEmptyString(name, "أدخل اسم المنطقة");

  const ref = db.collection("areas").doc();
  const batch = db.batch();
  const data = {
    name: cleanName,
    active: true,
    createdBy: actor.uid,
    createdAt: FieldValue.serverTimestamp(),
    updatedBy: actor.uid,
    updatedAt: FieldValue.serverTimestamp(),
  };
  batch.set(ref, data);
  logActivity(db, batch, {
    type: "area_added",
    entityType: "area",
    entityId: ref.id,
    actor,
    before: null,
    after: { ...data, id: ref.id },
  });
  await batch.commit();
  return ref.id;
}

export interface AreaPatch {
  name?: string;
  active?: boolean;
}

export async function updateAreaServer(
  db: Firestore,
  areaId: string,
  patch: AreaPatch,
  actor: Actor
): Promise<void> {
  requireManager(actor);
  const ref = db.collection("areas").doc(areaId);
  const snap = await ref.get();
  if (!snap.exists) throw new ServiceError("المنطقة غير موجودة", "NOT_FOUND", 404);
  const before = snap.data()!;

  const update: Record<string, unknown> = {
    updatedBy: actor.uid,
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (patch.name !== undefined) update.name = requireNonEmptyString(patch.name, "أدخل اسم المنطقة");
  if (patch.active !== undefined) update.active = patch.active;

  const batch = db.batch();
  batch.update(ref, update);
  logActivity(db, batch, {
    type: patch.active !== undefined ? "area_deactivated" : "area_edited",
    entityType: "area",
    entityId: areaId,
    actor,
    before,
    after: { ...before, ...update },
  });
  await batch.commit();
}

// ---------------------------------------------------------------------
// Workers
// ---------------------------------------------------------------------

export async function createWorkerServer(
  db: Firestore,
  input: { name: string; phone: string },
  actor: Actor
): Promise<string> {
  requireManager(actor);
  const name = requireNonEmptyString(input.name, "أدخل اسم العاملة");

  const ref = db.collection("workers").doc();
  const batch = db.batch();
  const data = {
    name,
    phone: input.phone?.trim() ?? "",
    active: true,
    createdBy: actor.uid,
    createdAt: FieldValue.serverTimestamp(),
    updatedBy: actor.uid,
    updatedAt: FieldValue.serverTimestamp(),
  };
  batch.set(ref, data);
  logActivity(db, batch, {
    type: "worker_added",
    entityType: "worker",
    entityId: ref.id,
    actor,
    before: null,
    after: { ...data, id: ref.id },
  });
  await batch.commit();
  return ref.id;
}

export interface WorkerPatch {
  name?: string;
  phone?: string;
  active?: boolean;
}

export async function updateWorkerServer(
  db: Firestore,
  workerId: string,
  patch: WorkerPatch,
  actor: Actor
): Promise<void> {
  requireManager(actor);
  const ref = db.collection("workers").doc(workerId);
  const snap = await ref.get();
  if (!snap.exists) throw new ServiceError("العاملة غير موجودة", "NOT_FOUND", 404);
  const before = snap.data()!;

  const update: Record<string, unknown> = {
    updatedBy: actor.uid,
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (patch.name !== undefined) update.name = requireNonEmptyString(patch.name, "أدخل اسم العاملة");
  if (patch.phone !== undefined) update.phone = patch.phone.trim();
  if (patch.active !== undefined) update.active = patch.active;

  const batch = db.batch();
  batch.update(ref, update);
  logActivity(db, batch, {
    type: patch.active !== undefined ? (patch.active ? "worker_activated" : "worker_deactivated") : "worker_edited",
    entityType: "worker",
    entityId: workerId,
    actor,
    before,
    after: { ...before, ...update },
  });
  await batch.commit();
}

/**
 * Permanent deletion — the worker document is removed from Firestore
 * entirely (no soft-delete/active flag involved). Bookings, recurring
 * schedules and route orders already carry their own denormalized
 * `workerName` set at creation time, so historical records keep showing the
 * correct name with no dependency on the worker document continuing to
 * exist, and are never touched here. The audit log entry is written in the
 * same batch as the delete so it's atomic with it, and — being a separate
 * document in `activityLogs` — survives the worker document's deletion.
 */
export async function deleteWorkerServer(db: Firestore, workerId: string, actor: Actor): Promise<void> {
  requireManager(actor);
  const ref = db.collection("workers").doc(workerId);
  const snap = await ref.get();
  if (!snap.exists) throw new ServiceError("العاملة غير موجودة", "NOT_FOUND", 404);
  const before = snap.data()!;

  const batch = db.batch();
  logActivity(db, batch, {
    type: "worker_deleted",
    entityType: "worker",
    entityId: workerId,
    actor,
    before,
    after: null,
  });
  batch.delete(ref);
  await batch.commit();
}

export interface WorkerFutureCommitments {
  futureBookings: number;
  activeRecurringSchedules: number;
}

/**
 * Cheap, read-only check for whether deactivating a worker would affect any
 * future operational use — used to warn a manager before they confirm a
 * deactivation. Uses count() aggregation for bookings (matches the existing
 * (workerId, status, date) composite index, so no new index is needed) and
 * fetches recurringSchedules by workerId alone (already single-field
 * indexed), filtering status in memory to avoid requiring a new composite
 * index for a one-off check.
 */
export async function getWorkerFutureCommitmentsServer(
  db: Firestore,
  workerId: string,
  fromDate: string,
  actor: Actor
): Promise<WorkerFutureCommitments> {
  requireManager(actor);

  const [bookingsCountSnap, recurringSnap] = await Promise.all([
    db
      .collection("bookings")
      .where("workerId", "==", workerId)
      .where("status", "==", "active")
      .where("date", ">=", fromDate)
      .count()
      .get(),
    db.collection("recurringSchedules").where("workerId", "==", workerId).get(),
  ]);

  const activeRecurringSchedules = recurringSnap.docs.filter(
    (d) => d.data().status === "active"
  ).length;

  return {
    futureBookings: bookingsCountSnap.data().count,
    activeRecurringSchedules,
  };
}

// ---------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------

export async function updateSettingsServer(
  db: Firestore,
  businessName: string,
  actor: Actor
): Promise<void> {
  requireManager(actor);
  const cleanName = requireNonEmptyString(businessName, "أدخل اسم النظام");

  const ref = db.collection("settings").doc("app");
  const batch = db.batch();
  batch.set(ref, {
    businessName: cleanName,
    timezone: BAHRAIN_TZ,
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: actor.uid,
  });
  const logRef = db.collection("activityLogs").doc();
  batch.set(logRef, {
    type: "settings_updated",
    entityType: "settings",
    entityId: "app",
    actingUid: actor.uid,
    actingEmail: actor.email,
    actingName: actor.name,
    before: null,
    after: { businessName: cleanName, timezone: BAHRAIN_TZ },
    createdAt: FieldValue.serverTimestamp(),
  });
  await batch.commit();
}
