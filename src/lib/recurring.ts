import {
  collection,
  doc,
  getDocs,
  query,
  serverTimestamp,
  where,
  writeBatch,
  type Firestore,
} from "firebase/firestore";
import { addDaysToDateStr } from "./date";
import type { ActingUser, EditableBookingFields } from "./booking";
import { cancelBooking, createBooking, updateBookingFields } from "./booking";
import type { Booking, PaymentMethod, RecurringSchedule, Shift } from "./types";

export class InvalidRecurringDayError extends Error {
  constructor() {
    super("لا يمكن جدولة موعد متكرر يوم الجمعة، فهو يوم إجازة ثابت.");
    this.name = "InvalidRecurringDayError";
  }
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
  actingUser: ActingUser;
}

export async function createRecurringSchedule(
  db: Firestore,
  input: CreateRecurringInput
): Promise<string> {
  if (input.dayOfWeek === 5) throw new InvalidRecurringDayError();

  const ref = doc(collection(db, "recurringSchedules"));
  const batch = writeBatch(db);
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
    createdBy: input.actingUser.uid,
    createdAt: serverTimestamp(),
    updatedBy: input.actingUser.uid,
    updatedAt: serverTimestamp(),
  };
  batch.set(ref, data);

  const logRef = doc(collection(db, "activityLogs"));
  batch.set(logRef, {
    type: "recurring_created",
    entityType: "recurringSchedule",
    entityId: ref.id,
    actingUid: input.actingUser.uid,
    actingEmail: input.actingUser.email,
    actingName: input.actingUser.name,
    before: null,
    after: { ...data, id: ref.id },
    createdAt: serverTimestamp(),
  });

  await batch.commit();
  return ref.id;
}

async function findMaterializedBooking(
  db: Firestore,
  recurringId: string,
  date: string
): Promise<Booking | null> {
  const snap = await getDocs(
    query(
      collection(db, "bookings"),
      where("recurringSeriesId", "==", recurringId),
      where("date", "==", date),
      where("status", "==", "active")
    )
  );
  if (snap.empty) return null;
  const d = snap.docs[0];
  return { id: d.id, ...d.data() } as Booking;
}

export type RecurringEditScope = "single" | "forward" | "entire";

export interface EditRecurringInput {
  recurring: RecurringSchedule;
  date: string; // the occurrence date the edit was triggered from
  scope: RecurringEditScope;
  fields: EditableBookingFields;
  actingUser: ActingUser;
}

/** Applies an edit to a recurring schedule per the required 3-way scope choice. */
export async function editRecurringOccurrence(
  db: Firestore,
  input: EditRecurringInput
): Promise<void> {
  const { recurring, date, scope, fields, actingUser } = input;

  if (scope === "single") {
    const existing = await findMaterializedBooking(db, recurring.id, date);
    if (existing) {
      await updateBookingFields(db, existing.id, fields, actingUser);
    } else {
      await createBooking(db, {
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
        actingUser,
      });
    }
    return;
  }

  if (scope === "entire") {
    const batch = writeBatch(db);
    const ref = doc(db, "recurringSchedules", recurring.id);
    const after = {
      areaId: fields.areaId,
      areaName: fields.areaName,
      hours: fields.hours,
      amount: fields.amount,
      paymentMethod: fields.paymentMethod,
      customerPhone: fields.customerPhone,
      customerLocation: fields.customerLocation,
      updatedBy: actingUser.uid,
      updatedAt: serverTimestamp(),
    };
    batch.update(ref, after);
    const logRef = doc(collection(db, "activityLogs"));
    batch.set(logRef, {
      type: "recurring_edited",
      entityType: "recurringSchedule",
      entityId: recurring.id,
      actingUid: actingUser.uid,
      actingEmail: actingUser.email,
      actingName: actingUser.name,
      before: { ...recurring },
      after: { ...recurring, ...after },
      createdAt: serverTimestamp(),
    });
    await batch.commit();
    return;
  }

  // scope === "forward": end the old series the day before, start a new one from `date`.
  const cutoffEnd = addDaysToDateStr(date, -1);
  const batch = writeBatch(db);
  const oldRef = doc(db, "recurringSchedules", recurring.id);
  batch.update(oldRef, {
    endDate: cutoffEnd,
    status: "ended",
    updatedBy: actingUser.uid,
    updatedAt: serverTimestamp(),
  });

  const newRef = doc(collection(db, "recurringSchedules"));
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
    createdBy: actingUser.uid,
    createdAt: serverTimestamp(),
    updatedBy: actingUser.uid,
    updatedAt: serverTimestamp(),
  };
  batch.set(newRef, newData);

  const logRef = doc(collection(db, "activityLogs"));
  batch.set(logRef, {
    type: "recurring_edited",
    entityType: "recurringSchedule",
    entityId: newRef.id,
    actingUid: actingUser.uid,
    actingEmail: actingUser.email,
    actingName: actingUser.name,
    before: { ...recurring },
    after: { ...newData, id: newRef.id },
    createdAt: serverTimestamp(),
  });

  await batch.commit();
}

export type RecurringCancelScope = "single" | "forward";

export interface CancelRecurringInput {
  recurring: RecurringSchedule;
  date: string;
  scope: RecurringCancelScope;
  reason: string | null;
  actingUser: ActingUser;
}

export async function cancelRecurringOccurrence(
  db: Firestore,
  input: CancelRecurringInput
): Promise<void> {
  const { recurring, date, scope, reason, actingUser } = input;

  if (scope === "single") {
    const existing = await findMaterializedBooking(db, recurring.id, date);
    if (existing) {
      await cancelBooking(db, existing.id, {
        reason,
        actingUser,
        cancelScope: "single",
      });
    }

    const batch = writeBatch(db);
    const exceptionRef = doc(db, "recurringExceptions", `${recurring.id}_${date}`);
    batch.set(exceptionRef, {
      recurringId: recurring.id,
      date,
      type: "cancelled",
      reason,
      createdBy: actingUser.uid,
      createdAt: serverTimestamp(),
    });
    if (!existing) {
      const logRef = doc(collection(db, "activityLogs"));
      batch.set(logRef, {
        type: "recurring_cancelled",
        entityType: "recurringException",
        entityId: exceptionRef.id,
        actingUid: actingUser.uid,
        actingEmail: actingUser.email,
        actingName: actingUser.name,
        before: null,
        after: { recurringId: recurring.id, date, type: "cancelled" },
        createdAt: serverTimestamp(),
      });
    }
    await batch.commit();
    return;
  }

  // scope === "forward"
  const cutoffEnd = addDaysToDateStr(date, -1);
  const batch = writeBatch(db);
  const ref = doc(db, "recurringSchedules", recurring.id);
  const ended = cutoffEnd < recurring.startDate;
  batch.update(ref, {
    endDate: ended ? recurring.endDate : cutoffEnd,
    status: ended ? "cancelled" : "ended",
    updatedBy: actingUser.uid,
    updatedAt: serverTimestamp(),
  });
  const logRef = doc(collection(db, "activityLogs"));
  batch.set(logRef, {
    type: "recurring_cancelled",
    entityType: "recurringSchedule",
    entityId: recurring.id,
    actingUid: actingUser.uid,
    actingEmail: actingUser.email,
    actingName: actingUser.name,
    before: { ...recurring },
    after: { ...recurring, endDate: cutoffEnd, status: "ended" },
    createdAt: serverTimestamp(),
  });
  await batch.commit();

  // Best-effort: release any already-materialized future occurrences of this series.
  const futureSnap = await getDocs(
    query(
      collection(db, "bookings"),
      where("recurringSeriesId", "==", recurring.id),
      where("status", "==", "active")
    )
  );
  const toCancel = futureSnap.docs.filter((d) => (d.data() as Booking).date >= date);
  for (const d of toCancel) {
    await cancelBooking(db, d.id, { reason, actingUser, cancelScope: "forward" });
  }
}

export function availableDaysOfWeek(): { value: number; labelAr: string }[] {
  return [
    { value: 0, labelAr: "الأحد" },
    { value: 1, labelAr: "الاثنين" },
    { value: 2, labelAr: "الثلاثاء" },
    { value: 3, labelAr: "الأربعاء" },
    { value: 4, labelAr: "الخميس" },
    { value: 6, labelAr: "السبت" },
  ];
}
