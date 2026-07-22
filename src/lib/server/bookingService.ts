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

function requireManager(actor: Actor) {
  if (actor.role !== "manager") {
    throw new ServiceError("هذا الإجراء متاح للمدير فقط", "FORBIDDEN", 403);
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
}

/**
 * Shared by every payment transition (mark paid / revert / edit-while-paid).
 * Payment method is required exactly when marking/keeping a booking paid;
 * amount, when provided, must be a non-negative number — never trusts the
 * client's arithmetic beyond that.
 */
function validatePaymentFields(isPaid: boolean, paymentMethod: PaymentMethod | null, paidAmount: number | null) {
  if (isPaid) {
    if (paymentMethod !== "benefit" && paymentMethod !== "cash") {
      throw new ServiceError("طريقة الدفع مطلوبة", "VALIDATION", 400);
    }
    if (typeof paidAmount !== "number" || !Number.isFinite(paidAmount) || paidAmount < 0) {
      throw new ServiceError("المبلغ المدفوع غير صالح", "VALIDATION", 400);
    }
  }
}

/**
 * Employees share the exact same GET /api/bookings endpoint managers use for
 * the Daily/Weekly schedule — this is the one place that enforces
 * requirement #7 (employees must never see payment information) for that
 * shared read path. Exported and unit-tested directly as a security
 * regression guard, independent of the route wiring.
 */
export function redactPaymentFields(booking: Booking): Booking {
  return {
    ...booking,
    paid: false,
    paymentMethod: null,
    paidAmount: null,
    paymentDate: null,
    paymentBy: null,
  };
}

/**
 * The full set of fields GET /api/bookings hides from a non-manager session:
 * every payment field (via redactPaymentFields) plus the agreed service
 * amount itself — the approved employee permissions list what an employee
 * may view (booking, area, customer phone/location, duration, route status)
 * and amount isn't on it, so it's treated the same as payment information
 * rather than left visible by omission.
 */
export function redactEmployeeRestrictedFields(booking: Booking): Booking {
  return { ...redactPaymentFields(booking), amount: 0 };
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
  customerName: string;
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

/**
 * The actual creation logic, with no authorization check of its own — every
 * caller is responsible for checking the actor first. There are exactly two
 * legitimate callers: `createBookingServer` (the public, manager-only entry
 * point) and `materializeOccurrenceBookingServer` (used only by
 * recurringService.ts to realize a not-yet-materialized recurring occurrence
 * into a concrete document, which must stay reachable by an employee marking
 * a drop-off/pickup — see updateBookingRouteStatusServer).
 */
async function createBookingCore(db: Firestore, input: CreateBookingInput, actor: Actor): Promise<string> {
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
      // Payment is never set at creation time — it's managed exclusively
      // afterward from the manager-only payment screens (see
      // updateBookingPaymentServer below).
      paymentMethod: null,
      paid: false,
      paidAmount: null,
      paymentDate: null,
      paymentBy: null,
      // Route (transport) status is likewise always unset at creation — see
      // updateBookingRouteStatusServer below.
      dropOffAt: null,
      pickupAt: null,
      customerName: input.customerName,
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

/** Manager only — booking creation is no longer available to employees at all. */
export async function createBookingServer(
  db: Firestore,
  input: CreateBookingInput,
  actor: Actor
): Promise<string> {
  requireManager(actor);
  return createBookingCore(db, input, actor);
}

/**
 * Used only by recurringService.ts to materialize a recurring occurrence
 * that hasn't been turned into a concrete Booking yet. Deliberately does NOT
 * require a manager: the "single scope edit" and "payment" materialization
 * paths are already gated by their own `requireManager` check before they
 * ever reach here, but marking a drop-off/pickup — an employee-permitted
 * action — must be able to materialize the occurrence too, since there is
 * nothing else that would create the booking on their behalf otherwise.
 */
export async function materializeOccurrenceBookingServer(
  db: Firestore,
  input: CreateBookingInput,
  actor: Actor
): Promise<string> {
  assertActive(actor);
  return createBookingCore(db, input, actor);
}

/**
 * Non-slot, non-payment fields (area/hours/amount/customer info).
 * `date`/`shift`/`workerId` are accepted here purely as a trusted,
 * server-side "move" primitive — the HTTP route never forwards them from the
 * client, since no UI feature exposes moving a booking. It exists so the
 * Friday authorization guarantee holds even if a "move" is ever wired up,
 * and so it can be exercised directly in tests. Payment is deliberately not
 * part of this patch at all — see updateBookingPaymentServer below, which is
 * the only way any of a booking's payment fields ever change.
 */
export interface BookingPatch {
  areaId: string;
  areaName: string;
  hours: number;
  amount: number;
  customerName: string;
  customerPhone: string;
  customerLocation: string;
  date?: string;
  shift?: Shift;
  workerId?: string;
  workerName?: string;
}

/** Manager only — editing a booking (including "move" to a different date/shift/worker) is no longer available to employees. */
export async function updateBookingServer(
  db: Firestore,
  bookingId: string,
  patch: BookingPatch,
  actor: Actor
): Promise<void> {
  requireManager(actor);
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

    const after: Record<string, unknown> = {
      areaId: patch.areaId,
      areaName: patch.areaName,
      hours: patch.hours,
      amount: patch.amount,
      customerName: patch.customerName,
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

/** Manager only — cancelling a booking is no longer available to employees. Releases the slot lock. */
export async function cancelBookingServer(
  db: Firestore,
  bookingId: string,
  options: {
    reason: string | null;
    cancelScope: "single" | "forward";
  },
  actor: Actor
): Promise<void> {
  requireManager(actor);
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

export interface PaymentPatch {
  isPaid: boolean;
  paymentMethod: PaymentMethod | null;
  paidAmount: number | null;
}

/**
 * The only function that ever changes a booking's payment fields — manager
 * only. Handles all three transitions in one place so the manager UI's
 * single Paid checkbox + method + amount panel can always call the same
 * endpoint regardless of the booking's current state:
 *
 *  - unpaid -> paid ("mark paid"): requires a payment method and a
 *    non-negative amount; paymentDate is stamped for the first time here.
 *  - paid -> unpaid ("revert"): clears method/amount/date/recordedBy
 *    outright, regardless of whatever the client sent for them.
 *  - paid -> paid with a different method and/or amount ("edit"): updates
 *    just those fields and leaves paymentDate untouched (it only ever
 *    records when a booking *first* became paid) — logged as one or two
 *    granular activity entries (payment_method_changed /
 *    payment_amount_changed) rather than another payment_marked_paid, so
 *    the audit trail distinguishes "this was paid again" from "the amount
 *    was corrected".
 *
 * `paymentBy` ("Recorded By") is updated on every transition to reflect
 * whoever most recently touched the payment record, and cleared on revert
 * along with everything else — an unpaid booking has no one to attribute a
 * payment to.
 */
export async function updateBookingPaymentServer(
  db: Firestore,
  bookingId: string,
  patch: PaymentPatch,
  actor: Actor
): Promise<void> {
  requireManager(actor);
  validatePaymentFields(patch.isPaid, patch.paymentMethod, patch.paidAmount);
  const bookingRef = db.collection("bookings").doc(bookingId);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(bookingRef);
    if (!snap.exists) throw new ServiceError("الحجز غير موجود", "NOT_FOUND", 404);
    const before = snap.data() as Booking;
    if (before.status !== "active") {
      throw new ServiceError("لا يمكن تعديل حجز ملغى", "INVALID_STATE", 400);
    }

    let after: Record<string, unknown>;
    const logs: { type: ActivityActionType }[] = [];

    if (!patch.isPaid) {
      after = {
        paid: false,
        paymentMethod: null,
        paidAmount: null,
        paymentDate: null,
        paymentBy: null,
      };
      if (before.paid) logs.push({ type: "payment_reverted" });
    } else if (!before.paid) {
      after = {
        paid: true,
        paymentMethod: patch.paymentMethod,
        paidAmount: patch.paidAmount,
        paymentDate: FieldValue.serverTimestamp(),
        paymentBy: actor.uid,
      };
      logs.push({ type: "payment_marked_paid" });
    } else {
      after = {
        paid: true,
        paymentMethod: patch.paymentMethod,
        paidAmount: patch.paidAmount,
        paymentDate: before.paymentDate,
        paymentBy: actor.uid,
      };
      if (before.paymentMethod !== patch.paymentMethod) logs.push({ type: "payment_method_changed" });
      if (before.paidAmount !== patch.paidAmount) logs.push({ type: "payment_amount_changed" });
    }

    if (logs.length === 0) return;

    after.updatedBy = actor.uid;
    after.updatedAt = FieldValue.serverTimestamp();
    tx.update(bookingRef, after);

    for (const log of logs) {
      logActivity(tx, db, {
        type: log.type,
        entityType: "booking",
        entityId: bookingId,
        actor,
        before: { ...before },
        after: { ...before, ...after },
      });
    }
  });
}

export type RouteStatusAction = "drop_off" | "pickup" | "reset_drop_off" | "reset_pickup";

const ROUTE_STATUS_LOG_TYPE: Record<RouteStatusAction, ActivityActionType> = {
  drop_off: "route_dropped_off",
  pickup: "route_picked_up",
  reset_drop_off: "route_dropoff_reset",
  reset_pickup: "route_pickup_reset",
};

/**
 * Marks (or, manager-only, resets) a booking's transport status — the only
 * write an employee is ever allowed to make: pressing "تم التنزيل" (drop
 * off) or "تم الاستلام" (pickup) on the Route Schedule. Pickup can only
 * follow a drop-off, and resetting the drop-off clears the pickup along with
 * it, so the two timestamps can never end up in an inconsistent order.
 */
export async function updateBookingRouteStatusServer(
  db: Firestore,
  bookingId: string,
  action: RouteStatusAction,
  actor: Actor
): Promise<void> {
  assertActive(actor);
  if (action === "reset_drop_off" || action === "reset_pickup") requireManager(actor);

  const bookingRef = db.collection("bookings").doc(bookingId);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(bookingRef);
    if (!snap.exists) throw new ServiceError("الحجز غير موجود", "NOT_FOUND", 404);
    const before = snap.data() as Booking;
    if (before.status !== "active") {
      throw new ServiceError("لا يمكن تعديل حجز ملغى", "INVALID_STATE", 400);
    }

    let after: Record<string, unknown>;
    if (action === "drop_off") {
      if (before.dropOffAt) throw new ServiceError("تم تسجيل التنزيل مسبقاً", "INVALID_STATE", 400);
      after = { dropOffAt: FieldValue.serverTimestamp() };
    } else if (action === "pickup") {
      if (!before.dropOffAt) throw new ServiceError("يجب تسجيل التنزيل أولاً", "INVALID_STATE", 400);
      if (before.pickupAt) throw new ServiceError("تم تسجيل الاستلام مسبقاً", "INVALID_STATE", 400);
      after = { pickupAt: FieldValue.serverTimestamp() };
    } else if (action === "reset_drop_off") {
      after = { dropOffAt: null, pickupAt: null };
    } else {
      after = { pickupAt: null };
    }

    after.updatedBy = actor.uid;
    after.updatedAt = FieldValue.serverTimestamp();
    tx.update(bookingRef, after);

    logActivity(tx, db, {
      type: ROUTE_STATUS_LOG_TYPE[action],
      entityType: "booking",
      entityId: bookingId,
      actor,
      before: { ...before },
      after: { ...before, ...after },
    });
  });
}
