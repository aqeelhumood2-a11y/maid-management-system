import {
  collection,
  doc,
  runTransaction,
  serverTimestamp,
  type Firestore,
  type Transaction,
} from "firebase/firestore";
import { slotId } from "./availability";
import type {
  ActivityActionType,
  Booking,
  BookingSource,
  PaymentMethod,
  Shift,
} from "./types";

export const BOOKING_CONFLICT_MESSAGE_AR =
  "تم حجز العاملة للتو، اختر عاملة أخرى.";

export class BookingConflictError extends Error {
  constructor() {
    super(BOOKING_CONFLICT_MESSAGE_AR);
    this.name = "BookingConflictError";
  }
}

export interface ActingUser {
  uid: string;
  email: string;
  name: string;
}

export function logActivity(
  tx: Transaction,
  db: Firestore,
  entry: {
    type: ActivityActionType;
    entityType: string;
    entityId: string;
    actingUser: ActingUser;
    before: Record<string, unknown> | null;
    after: Record<string, unknown> | null;
  }
) {
  const ref = doc(collection(db, "activityLogs"));
  tx.set(ref, {
    type: entry.type,
    entityType: entry.entityType,
    entityId: entry.entityId,
    actingUid: entry.actingUser.uid,
    actingEmail: entry.actingUser.email,
    actingName: entry.actingUser.name,
    before: entry.before,
    after: entry.after,
    createdAt: serverTimestamp(),
  });
}

export interface CreateBookingInput {
  date: string;
  shift: Shift;
  workerId: string;
  workerName: string;
  areaId: string;
  areaName: string;
  hours: number;
  amount: number;
  paymentMethod: PaymentMethod | null;
  customerPhone: string;
  customerLocation: string;
  source: BookingSource;
  recurringSeriesId: string | null;
  actingUser: ActingUser;
}

/**
 * Atomically checks the slot lock and creates the booking. Re-validated inside the
 * transaction so concurrent saves for the same worker/date/shift cannot both win:
 * Firestore retries the transaction on conflicting writes, and the loser sees the
 * slot doc already exists and throws BookingConflictError instead of committing.
 */
export async function createBooking(
  db: Firestore,
  input: CreateBookingInput
): Promise<string> {
  const bookingRef = doc(collection(db, "bookings"));
  const slotRef = doc(db, "slots", slotId(input.workerId, input.date, input.shift));

  await runTransaction(db, async (tx) => {
    const slotSnap = await tx.get(slotRef);
    if (slotSnap.exists()) {
      throw new BookingConflictError();
    }

    const bookingData = {
      date: input.date,
      shift: input.shift,
      workerId: input.workerId,
      workerName: input.workerName,
      areaId: input.areaId,
      areaName: input.areaName,
      hours: input.hours,
      amount: input.amount,
      paymentMethod: input.paymentMethod,
      paid: input.paymentMethod !== null,
      paymentDate: input.paymentMethod !== null ? serverTimestamp() : null,
      paymentBy: input.paymentMethod !== null ? input.actingUser.uid : null,
      customerPhone: input.customerPhone,
      customerLocation: input.customerLocation,
      source: input.source,
      recurringSeriesId: input.recurringSeriesId,
      status: "active" as const,
      cancelledAt: null,
      cancelledBy: null,
      cancelledReason: null,
      cancelScope: null,
      createdBy: input.actingUser.uid,
      createdAt: serverTimestamp(),
      updatedBy: input.actingUser.uid,
      updatedAt: serverTimestamp(),
    };

    tx.set(bookingRef, bookingData);
    tx.set(slotRef, {
      bookingId: bookingRef.id,
      workerId: input.workerId,
      date: input.date,
      shift: input.shift,
      createdAt: serverTimestamp(),
    });

    logActivity(tx, db, {
      type: "booking_created",
      entityType: "booking",
      entityId: bookingRef.id,
      actingUser: input.actingUser,
      before: null,
      after: { ...bookingData, id: bookingRef.id },
    });
  });

  return bookingRef.id;
}

export interface EditableBookingFields {
  areaId: string;
  areaName: string;
  hours: number;
  amount: number;
  paymentMethod: PaymentMethod | null;
  customerPhone: string;
  customerLocation: string;
}

/** Edits non-slot fields (area/hours/amount/payment/customer info). Worker/date/shift never change. */
export async function updateBookingFields(
  db: Firestore,
  bookingId: string,
  patch: EditableBookingFields,
  actingUser: ActingUser
): Promise<void> {
  const bookingRef = doc(db, "bookings", bookingId);

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(bookingRef);
    if (!snap.exists()) throw new Error("الحجز غير موجود");
    const before = snap.data() as Booking;
    if (before.status !== "active") {
      throw new Error("لا يمكن تعديل حجز ملغى");
    }

    const paid = patch.paymentMethod !== null;
    const after = {
      areaId: patch.areaId,
      areaName: patch.areaName,
      hours: patch.hours,
      amount: patch.amount,
      paymentMethod: patch.paymentMethod,
      paid,
      paymentDate: paid ? before.paymentDate ?? serverTimestamp() : null,
      paymentBy: paid ? before.paymentBy ?? actingUser.uid : null,
      customerPhone: patch.customerPhone,
      customerLocation: patch.customerLocation,
      updatedBy: actingUser.uid,
      updatedAt: serverTimestamp(),
    };

    tx.update(bookingRef, after);

    logActivity(tx, db, {
      type: "booking_edited",
      entityType: "booking",
      entityId: bookingId,
      actingUser,
      before: { ...before },
      after: { ...before, ...after },
    });
  });
}

/** Cancels a concrete booking and releases its slot lock. */
export async function cancelBooking(
  db: Firestore,
  bookingId: string,
  options: {
    reason: string | null;
    actingUser: ActingUser;
    cancelScope: "single" | "forward";
  }
): Promise<void> {
  const bookingRef = doc(db, "bookings", bookingId);

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(bookingRef);
    if (!snap.exists()) throw new Error("الحجز غير موجود");
    const before = snap.data() as Booking;
    if (before.status !== "active") {
      throw new Error("الحجز ملغى بالفعل");
    }

    const slotRef = doc(db, "slots", slotId(before.workerId, before.date, before.shift));

    const after = {
      status: "cancelled" as const,
      cancelledAt: serverTimestamp(),
      cancelledBy: options.actingUser.uid,
      cancelledReason: options.reason,
      cancelScope: options.cancelScope,
      updatedBy: options.actingUser.uid,
      updatedAt: serverTimestamp(),
    };

    tx.update(bookingRef, after);
    tx.delete(slotRef);

    logActivity(tx, db, {
      type: "booking_cancelled",
      entityType: "booking",
      entityId: bookingId,
      actingUser: options.actingUser,
      before: { ...before },
      after: { ...before, ...after },
    });
  });
}

export async function markBookingPaid(
  db: Firestore,
  bookingId: string,
  options: { paymentMethod: PaymentMethod; actingUser: ActingUser }
): Promise<void> {
  const bookingRef = doc(db, "bookings", bookingId);

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(bookingRef);
    if (!snap.exists()) throw new Error("الحجز غير موجود");
    const before = snap.data() as Booking;
    if (before.status !== "active") {
      throw new Error("لا يمكن تعديل حجز ملغى");
    }

    const after = {
      paymentMethod: options.paymentMethod,
      paid: true,
      paymentDate: serverTimestamp(),
      paymentBy: options.actingUser.uid,
      updatedBy: options.actingUser.uid,
      updatedAt: serverTimestamp(),
    };

    tx.update(bookingRef, after);

    logActivity(tx, db, {
      type: "payment_marked_paid",
      entityType: "booking",
      entityId: bookingId,
      actingUser: options.actingUser,
      before: { ...before },
      after: { ...before, ...after },
    });
  });
}
