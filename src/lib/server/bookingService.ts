import { FieldValue, type Firestore, type Transaction } from "firebase-admin/firestore";
import { isFriday } from "../date";
import { slotId } from "../availability";
import { ServiceError } from "./errors";
import type {
  ActivityActionType,
  Booking,
  BookingSource,
  PaymentMethod,
  Shift,
} from "../types";

/**
 * All mutation of `bookings` / `slots` happens here, server-side, under the
 * Admin SDK (which bypasses Firestore rules). This is intentional: the
 * Friday-exceptional-booking rule ("only a manager may create, edit, or move
 * a booking into a Friday slot") cannot be reliably validated by Firestore
 * security rules, which have no reliable way to derive a weekday from a
 * plain `yyyy-MM-dd` string. Routing every write through this trusted layer
 * — instead of relying on the client to behave — is what actually enforces
 * it; Firestore rules additionally deny ALL direct client writes to these
 * two collections as defense in depth.
 */

export const BOOKING_CONFLICT_MESSAGE_AR = "تم حجز العاملة للتو، اختر عاملة أخرى.";
export const FRIDAY_RESTRICTED_MESSAGE_AR =
  "الحجز الاستثنائي في يوم الجمعة متاح للمدير فقط.";

export { ServiceError };

export class BookingConflictError extends ServiceError {
  constructor() {
    super(BOOKING_CONFLICT_MESSAGE_AR, "SLOT_CONFLICT", 409);
    this.name = "BookingConflictError";
  }
}

export class FridayRestrictedError extends ServiceError {
  constructor() {
    super(FRIDAY_RESTRICTED_MESSAGE_AR, "FRIDAY_RESTRICTED", 403);
    this.name = "FridayRestrictedError";
  }
}

export interface Actor {
  uid: string;
  email: string;
  name: string;
  role: "employee" | "manager";
}

function assertActive(actor: Actor) {
  if (actor.role !== "employee" && actor.role !== "manager") {
    throw new ServiceError("صلاحية غير معروفة", "FORBIDDEN", 403);
  }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Field-level validation Firestore rules used to provide. Now that
 * bookings/slots are written exclusively through this server layer (rules
 * deny direct client writes outright), this is the only place enforcing
 * shape and enum constraints — it must not be skipped.
 */
function validateBookingFields(fields: {
  date?: string;
  shift?: Shift;
  workerId?: string;
  areaId?: string;
  hours: number;
  amount: number;
  paymentMethod: PaymentMethod | null;
}) {
  if (fields.date !== undefined && !DATE_RE.test(fields.date)) {
    throw new ServiceError("تاريخ غير صالح", "VALIDATION", 400);
  }
  if (fields.shift !== undefined && fields.shift !== "morning" && fields.shift !== "afternoon") {
    throw new ServiceError("فترة غير صالحة", "VALIDATION", 400);
  }
  if (fields.workerId !== undefined && !fields.workerId) {
    throw new ServiceError("العاملة مطلوبة", "VALIDATION", 400);
  }
  if (fields.areaId !== undefined && !fields.areaId) {
    throw new ServiceError("المنطقة مطلوبة", "VALIDATION", 400);
  }
  if (typeof fields.hours !== "number" || !(fields.hours > 0)) {
    throw new ServiceError("عدد ساعات غير صالح", "VALIDATION", 400);
  }
  if (typeof fields.amount !== "number" || fields.amount < 0) {
    throw new ServiceError("مبلغ غير صالح", "VALIDATION", 400);
  }
  if (
    fields.paymentMethod !== null &&
    fields.paymentMethod !== "benefit" &&
    fields.paymentMethod !== "cash"
  ) {
    throw new ServiceError("طريقة دفع غير صالحة", "VALIDATION", 400);
  }
}

function logActivity(
  tx: Transaction,
  db: Firestore,
  entry: {
    type: ActivityActionType;
    entityType: string;
    entityId: string;
    actor: Actor;
    before: Record<string, unknown> | null;
    after: Record<string, unknown> | null;
  }
) {
  const ref = db.collection("activityLogs").doc();
  tx.set(ref, {
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
}

/**
 * Atomically checks the slot lock and creates the booking. Re-validated
 * inside the transaction so concurrent saves for the same worker/date/shift
 * cannot both win: Firestore retries the transaction on conflicting writes,
 * and the loser sees the slot doc already exists and throws
 * BookingConflictError instead of committing.
 */
const VALID_SOURCES: BookingSource[] = ["today", "weekly", "manager_future", "recurring"];

export async function createBookingServer(
  db: Firestore,
  input: CreateBookingInput,
  actor: Actor
): Promise<string> {
  assertActive(actor);
  validateBookingFields(input);
  if (!VALID_SOURCES.includes(input.source)) {
    throw new ServiceError("مصدر الحجز غير صالح", "VALIDATION", 400);
  }
  if (isFriday(input.date) && actor.role !== "manager") {
    throw new FridayRestrictedError();
  }

  const bookingRef = db.collection("bookings").doc();
  const slotRef = db.collection("slots").doc(slotId(input.workerId, input.date, input.shift));

  await db.runTransaction(async (tx) => {
    const slotSnap = await tx.get(slotRef);
    if (slotSnap.exists) {
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
      paymentDate: input.paymentMethod !== null ? FieldValue.serverTimestamp() : null,
      paymentBy: input.paymentMethod !== null ? actor.uid : null,
      customerPhone: input.customerPhone,
      customerLocation: input.customerLocation,
      source: input.source,
      recurringSeriesId: input.recurringSeriesId,
      status: "active" as const,
      cancelledAt: null,
      cancelledBy: null,
      cancelledReason: null,
      cancelScope: null,
      createdBy: actor.uid,
      createdAt: FieldValue.serverTimestamp(),
      updatedBy: actor.uid,
      updatedAt: FieldValue.serverTimestamp(),
    };

    tx.set(bookingRef, bookingData);
    tx.set(slotRef, {
      bookingId: bookingRef.id,
      workerId: input.workerId,
      date: input.date,
      shift: input.shift,
      createdAt: FieldValue.serverTimestamp(),
    });

    logActivity(tx, db, {
      type: "booking_created",
      entityType: "booking",
      entityId: bookingRef.id,
      actor,
      before: null,
      after: { ...bookingData, id: bookingRef.id },
    });
  });

  return bookingRef.id;
}

/**
 * Non-slot fields are always editable (area/hours/amount/payment/customer
 * info). `date`/`shift`/`workerId` are accepted here purely as a trusted,
 * server-side "move" primitive — the HTTP route never forwards them from the
 * client, since no UI feature exposes moving a booking. It exists so the
 * Friday authorization guarantee holds even if a "move" is ever wired up,
 * and so it can be exercised directly in tests.
 */
export interface BookingPatch {
  areaId: string;
  areaName: string;
  hours: number;
  amount: number;
  paymentMethod: PaymentMethod | null;
  customerPhone: string;
  customerLocation: string;
  date?: string;
  shift?: Shift;
  workerId?: string;
  workerName?: string;
}

export async function updateBookingServer(
  db: Firestore,
  bookingId: string,
  patch: BookingPatch,
  actor: Actor
): Promise<void> {
  assertActive(actor);
  validateBookingFields(patch);
  const bookingRef = db.collection("bookings").doc(bookingId);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(bookingRef);
    if (!snap.exists) throw new ServiceError("الحجز غير موجود", "NOT_FOUND", 404);
    const before = snap.data() as Booking;
    if (before.status !== "active") {
      throw new ServiceError("لا يمكن تعديل حجز ملغى", "INVALID_STATE", 400);
    }

    const targetDate = patch.date ?? before.date;
    const targetShift = patch.shift ?? before.shift;
    const targetWorkerId = patch.workerId ?? before.workerId;
    const isMove =
      targetDate !== before.date || targetShift !== before.shift || targetWorkerId !== before.workerId;

    if (isMove && isFriday(targetDate) && actor.role !== "manager") {
      throw new FridayRestrictedError();
    }

    let newSlotRef = null;
    let oldSlotRef = null;
    if (isMove) {
      oldSlotRef = db.collection("slots").doc(slotId(before.workerId, before.date, before.shift));
      newSlotRef = db.collection("slots").doc(slotId(targetWorkerId, targetDate, targetShift));
      const newSlotSnap = await tx.get(newSlotRef);
      if (newSlotSnap.exists) {
        throw new BookingConflictError();
      }
    }

    const paid = patch.paymentMethod !== null;
    const after: Record<string, unknown> = {
      areaId: patch.areaId,
      areaName: patch.areaName,
      hours: patch.hours,
      amount: patch.amount,
      paymentMethod: patch.paymentMethod,
      paid,
      paymentDate: paid ? before.paymentDate ?? FieldValue.serverTimestamp() : null,
      paymentBy: paid ? before.paymentBy ?? actor.uid : null,
      customerPhone: patch.customerPhone,
      customerLocation: patch.customerLocation,
      updatedBy: actor.uid,
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (isMove) {
      after.date = targetDate;
      after.shift = targetShift;
      after.workerId = targetWorkerId;
      if (patch.workerName) after.workerName = patch.workerName;
    }

    tx.update(bookingRef, after);
    if (isMove && oldSlotRef && newSlotRef) {
      tx.delete(oldSlotRef);
      tx.set(newSlotRef, {
        bookingId: bookingRef.id,
        workerId: targetWorkerId,
        date: targetDate,
        shift: targetShift,
        createdAt: FieldValue.serverTimestamp(),
      });
    }

    logActivity(tx, db, {
      type: "booking_edited",
      entityType: "booking",
      entityId: bookingId,
      actor,
      before: { ...before },
      after: { ...before, ...after },
    });
  });
}

/** Cancels a concrete booking and releases its slot lock. */
export async function cancelBookingServer(
  db: Firestore,
  bookingId: string,
  options: {
    reason: string | null;
    cancelScope: "single" | "forward";
  },
  actor: Actor
): Promise<void> {
  assertActive(actor);
  const bookingRef = db.collection("bookings").doc(bookingId);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(bookingRef);
    if (!snap.exists) throw new ServiceError("الحجز غير موجود", "NOT_FOUND", 404);
    const before = snap.data() as Booking;
    if (before.status !== "active") {
      throw new ServiceError("الحجز ملغى بالفعل", "INVALID_STATE", 400);
    }

    const slotRef = db.collection("slots").doc(slotId(before.workerId, before.date, before.shift));

    const after = {
      status: "cancelled" as const,
      cancelledAt: FieldValue.serverTimestamp(),
      cancelledBy: actor.uid,
      cancelledReason: options.reason,
      cancelScope: options.cancelScope,
      updatedBy: actor.uid,
      updatedAt: FieldValue.serverTimestamp(),
    };

    tx.update(bookingRef, after);
    tx.delete(slotRef);

    logActivity(tx, db, {
      type: "booking_cancelled",
      entityType: "booking",
      entityId: bookingId,
      actor,
      before: { ...before },
      after: { ...before, ...after },
    });
  });
}

export async function markBookingPaidServer(
  db: Firestore,
  bookingId: string,
  options: { paymentMethod: PaymentMethod },
  actor: Actor
): Promise<void> {
  assertActive(actor);
  const bookingRef = db.collection("bookings").doc(bookingId);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(bookingRef);
    if (!snap.exists) throw new ServiceError("الحجز غير موجود", "NOT_FOUND", 404);
    const before = snap.data() as Booking;
    if (before.status !== "active") {
      throw new ServiceError("لا يمكن تعديل حجز ملغى", "INVALID_STATE", 400);
    }

    const after = {
      paymentMethod: options.paymentMethod,
      paid: true,
      paymentDate: FieldValue.serverTimestamp(),
      paymentBy: actor.uid,
      updatedBy: actor.uid,
      updatedAt: FieldValue.serverTimestamp(),
    };

    tx.update(bookingRef, after);

    logActivity(tx, db, {
      type: "payment_marked_paid",
      entityType: "booking",
      entityId: bookingId,
      actor,
      before: { ...before },
      after: { ...before, ...after },
    });
  });
}
