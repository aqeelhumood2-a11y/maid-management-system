import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { addDaysToDateStr } from "../date";
import type { Booking, PaymentMethod, RecurringSchedule, Shift } from "../types";
import {
  cancelBookingServer,
  createBookingServer,
  ServiceError,
  updateBookingServer,
  type Actor,
  type BookingPatch,
} from "./bookingService";

/**
 * Recurring-schedule management is a manager-only feature end to end. It is
 * routed through the Admin SDK for the same reason bookings are: the
 * "single" edit/cancel scopes materialize or release a concrete Booking
 * (writing to `bookings`/`slots`), which are no longer directly writable by
 * any client.
 */

export class InvalidRecurringDayError extends ServiceError {
  constructor() {
    super(
      "لا يمكن جدولة موعد متكرر يوم الجمعة، فهو يوم إجازة ثابت.",
      "INVALID_DAY",
      400
    );
    this.name = "InvalidRecurringDayError";
  }
}

function requireManager(actor: Actor) {
  if (actor.role !== "manager") {
    throw new ServiceError("هذا الإجراء متاح للمدير فقط", "FORBIDDEN", 403);
  }
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

export interface CreateRecurringInput {
  workerId: string;
  workerName: string;
  areaId: string;
  areaName: string;
  shift: Shift;
  dayOfWeek: number;
  hours: number;
  amount: number;
  paymentMethod: PaymentMethod | null;
  customerPhone: string;
  customerLocation: string;
  startDate: string;
}

export async function createRecurringScheduleServer(
  db: Firestore,
  input: CreateRecurringInput,
  actor: Actor
): Promise<string> {
  requireManager(actor);
  if (input.dayOfWeek === 5) throw new InvalidRecurringDayError();

  const ref = db.collection("recurringSchedules").doc();
  const batch = db.batch();
  const data = {
    workerId: input.workerId,
    workerName: input.workerName,
    areaId: input.areaId,
    areaName: input.areaName,
    shift: input.shift,
    dayOfWeek: input.dayOfWeek,
    hours: input.hours,
    amount: input.amount,
    paymentMethod: input.paymentMethod,
    customerPhone: input.customerPhone,
    customerLocation: input.customerLocation,
    startDate: input.startDate,
    endDate: null,
    status: "active" as const,
    replacesId: null,
    createdBy: actor.uid,
    createdAt: FieldValue.serverTimestamp(),
    updatedBy: actor.uid,
    updatedAt: FieldValue.serverTimestamp(),
  };
  batch.set(ref, data);
  logActivity(db, batch, {
    type: "recurring_created",
    entityType: "recurringSchedule",
    entityId: ref.id,
    actor,
    before: null,
    after: { ...data, id: ref.id },
  });
  await batch.commit();
  return ref.id;
}

async function findMaterializedBooking(
  db: Firestore,
  recurringId: string,
  date: string
): Promise<Booking | null> {
  const snap = await db
    .collection("bookings")
    .where("recurringSeriesId", "==", recurringId)
    .where("date", "==", date)
    .where("status", "==", "active")
    .limit(1)
    .get();
  if (snap.empty) return null;
  const d = snap.docs[0];
  return { id: d.id, ...d.data() } as Booking;
}

export type RecurringEditScope = "single" | "forward" | "entire";

export interface EditRecurringInput {
  recurring: RecurringSchedule;
  date: string;
  scope: RecurringEditScope;
  fields: Omit<BookingPatch, "date" | "shift" | "workerId" | "workerName">;
}

export async function editRecurringOccurrenceServer(
  db: Firestore,
  input: EditRecurringInput,
  actor: Actor
): Promise<void> {
  requireManager(actor);
  const { recurring, date, scope, fields } = input;

  if (scope === "single") {
    const existing = await findMaterializedBooking(db, recurring.id, date);
    if (existing) {
      await updateBookingServer(db, existing.id, fields, actor);
    } else {
      await createBookingServer(
        db,
        {
          date,
          shift: recurring.shift,
          workerId: recurring.workerId,
          workerName: recurring.workerName,
          areaId: fields.areaId,
          areaName: fields.areaName,
          hours: fields.hours,
          amount: fields.amount,
          paymentMethod: fields.paymentMethod,
          customerPhone: fields.customerPhone,
          customerLocation: fields.customerLocation,
          source: "recurring",
          recurringSeriesId: recurring.id,
        },
        actor
      );
    }
    return;
  }

  if (scope === "entire") {
    const batch = db.batch();
    const ref = db.collection("recurringSchedules").doc(recurring.id);
    const after = {
      areaId: fields.areaId,
      areaName: fields.areaName,
      hours: fields.hours,
      amount: fields.amount,
      paymentMethod: fields.paymentMethod,
      customerPhone: fields.customerPhone,
      customerLocation: fields.customerLocation,
      updatedBy: actor.uid,
      updatedAt: FieldValue.serverTimestamp(),
    };
    batch.update(ref, after);
    logActivity(db, batch, {
      type: "recurring_edited",
      entityType: "recurringSchedule",
      entityId: recurring.id,
      actor,
      before: { ...recurring },
      after: { ...recurring, ...after },
    });
    await batch.commit();
    return;
  }

  // scope === "forward": end the old series the day before, start a new one from `date`.
  const cutoffEnd = addDaysToDateStr(date, -1);
  const batch = db.batch();
  const oldRef = db.collection("recurringSchedules").doc(recurring.id);
  batch.update(oldRef, {
    endDate: cutoffEnd,
    status: "ended",
    updatedBy: actor.uid,
    updatedAt: FieldValue.serverTimestamp(),
  });

  const newRef = db.collection("recurringSchedules").doc();
  const newData = {
    workerId: recurring.workerId,
    workerName: recurring.workerName,
    areaId: fields.areaId,
    areaName: fields.areaName,
    shift: recurring.shift,
    dayOfWeek: recurring.dayOfWeek,
    hours: fields.hours,
    amount: fields.amount,
    paymentMethod: fields.paymentMethod,
    customerPhone: fields.customerPhone,
    customerLocation: fields.customerLocation,
    startDate: date,
    endDate: null,
    status: "active" as const,
    replacesId: recurring.id,
    createdBy: actor.uid,
    createdAt: FieldValue.serverTimestamp(),
    updatedBy: actor.uid,
    updatedAt: FieldValue.serverTimestamp(),
  };
  batch.set(newRef, newData);
  logActivity(db, batch, {
    type: "recurring_edited",
    entityType: "recurringSchedule",
    entityId: newRef.id,
    actor,
    before: { ...recurring },
    after: { ...newData, id: newRef.id },
  });
  await batch.commit();
}

export type RecurringCancelScope = "single" | "forward";

export interface CancelRecurringInput {
  recurring: RecurringSchedule;
  date: string;
  scope: RecurringCancelScope;
  reason: string | null;
}

export async function cancelRecurringOccurrenceServer(
  db: Firestore,
  input: CancelRecurringInput,
  actor: Actor
): Promise<void> {
  requireManager(actor);
  const { recurring, date, scope, reason } = input;

  if (scope === "single") {
    const existing = await findMaterializedBooking(db, recurring.id, date);
    if (existing) {
      await cancelBookingServer(db, existing.id, { reason, cancelScope: "single" }, actor);
    }

    const batch = db.batch();
    const exceptionRef = db.collection("recurringExceptions").doc(`${recurring.id}_${date}`);
    batch.set(exceptionRef, {
      recurringId: recurring.id,
      date,
      type: "cancelled",
      reason,
      createdBy: actor.uid,
      createdAt: FieldValue.serverTimestamp(),
    });
    if (!existing) {
      logActivity(db, batch, {
        type: "recurring_cancelled",
        entityType: "recurringException",
        entityId: exceptionRef.id,
        actor,
        before: null,
        after: { recurringId: recurring.id, date, type: "cancelled" },
      });
    }
    await batch.commit();
    return;
  }

  // scope === "forward"
  const cutoffEnd = addDaysToDateStr(date, -1);
  const batch = db.batch();
  const ref = db.collection("recurringSchedules").doc(recurring.id);
  const ended = cutoffEnd < recurring.startDate;
  batch.update(ref, {
    endDate: ended ? recurring.endDate : cutoffEnd,
    status: ended ? "cancelled" : "ended",
    updatedBy: actor.uid,
    updatedAt: FieldValue.serverTimestamp(),
  });
  logActivity(db, batch, {
    type: "recurring_cancelled",
    entityType: "recurringSchedule",
    entityId: recurring.id,
    actor,
    before: { ...recurring },
    after: { ...recurring, endDate: cutoffEnd, status: "ended" },
  });
  await batch.commit();

  // Best-effort: release any already-materialized future occurrences of this series.
  const futureSnap = await db
    .collection("bookings")
    .where("recurringSeriesId", "==", recurring.id)
    .where("status", "==", "active")
    .get();
  const toCancel = futureSnap.docs.filter((d) => (d.data() as Booking).date >= date);
  for (const d of toCancel) {
    await cancelBookingServer(db, d.id, { reason, cancelScope: "forward" }, actor);
  }
}
