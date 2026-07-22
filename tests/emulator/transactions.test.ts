import { initializeApp, getApps, deleteApp, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  BookingConflictError,
  createBookingServer,
  cancelBookingServer,
  FridayRestrictedError,
  materializeOccurrenceBookingServer,
  ServiceError,
  updateBookingPaymentServer,
  updateBookingRouteStatusServer,
  updateBookingServer,
  type Actor,
} from "@/lib/server/bookingService";
import {
  cancelRecurringOccurrenceServer,
  createRecurringScheduleServer,
  editRecurringOccurrenceServer,
  setRecurringOccurrencePaymentServer,
  setRecurringOccurrenceRouteStatusServer,
} from "@/lib/server/recurringService";
import { resolveCell } from "@/lib/availability";
import { addDaysToDateStr, todayBahrain } from "@/lib/date";
import type { RecurringSchedule, Worker } from "@/lib/types";

/**
 * These tests exercise the trusted server layer directly (the same
 * functions the API routes under src/app/api/bookings and
 * src/app/api/recurring call) against the Firestore emulator, using the
 * Admin SDK exactly like production does. This is deliberately NOT a
 * client-SDK / Firestore-rules test — the point is to prove the
 * authorization decision is enforced in code that a client can never
 * bypass, not by something the client sends. Direct client write rejection
 * is covered separately in tests/emulator/rules.test.ts.
 *
 * Per the approved employee/manager permissions: booking creation, editing
 * and cancellation are manager-only end to end now — an employee session
 * has exactly one write capability anywhere in this app, marking a
 * booking's route status (drop-off/pickup), tested separately below.
 */

let app: App;
let db: Firestore;

const WEEKDAY_DATE = "2026-07-22"; // Wednesday
const FRIDAY_DATE = "2026-07-24"; // Friday
const ANOTHER_WEEKDAY_DATE = "2026-07-23"; // Thursday

const MANAGER: Actor = { uid: "mgr", email: "mgr@example.com", name: "المدير", role: "manager" };
const EMPLOYEE: Actor = { uid: "emp", email: "emp@example.com", name: "الموظفة", role: "employee" };

beforeAll(() => {
  const existing = getApps().find((a) => a.name === "tx-test-app");
  app = existing ?? initializeApp({ projectId: "demo-maid-mgmt-tx" }, "tx-test-app");
  db = getFirestore(app);
});

afterAll(async () => {
  await deleteApp(app);
});

async function clearCollections() {
  for (const name of ["bookings", "slots", "recurringSchedules", "recurringExceptions", "activityLogs"]) {
    const snap = await db.collection(name).get();
    await Promise.all(snap.docs.map((d) => d.ref.delete()));
  }
}

const BASE_INPUT = {
  date: WEEKDAY_DATE,
  shift: "morning" as const,
  workerId: "w1",
  workerName: "سارة",
  areaId: "a1",
  areaName: "المنامة",
  hours: 4,
  amount: 12,
  customerPhone: "36000000",
  customerLocation: "قريب من السوق",
  source: "today" as const,
  recurringSeriesId: null,
};

describe("createBookingServer — manager only", () => {
  it("rejects an employee from creating a booking at all, on a normal weekday", async () => {
    await clearCollections();
    await expect(createBookingServer(db, { ...BASE_INPUT, date: WEEKDAY_DATE }, EMPLOYEE)).rejects.toThrow(
      ServiceError
    );
    const bookings = await db.collection("bookings").get();
    expect(bookings.size).toBe(0);
  });

  it("lets a manager create a normal weekday booking", async () => {
    await clearCollections();
    const id = await createBookingServer(db, { ...BASE_INPUT, date: WEEKDAY_DATE }, MANAGER);
    const snap = await db.collection("bookings").doc(id).get();
    expect(snap.exists).toBe(true);
    expect(snap.data()?.status).toBe("active");
  });

  it("rejects an employee creating a booking on Friday too, and writes nothing", async () => {
    await clearCollections();
    await expect(createBookingServer(db, { ...BASE_INPUT, date: FRIDAY_DATE }, EMPLOYEE)).rejects.toThrow(
      ServiceError
    );
    const bookings = await db.collection("bookings").get();
    const slots = await db.collection("slots").get();
    expect(bookings.size).toBe(0);
    expect(slots.size).toBe(0);
  });

  it("lets a manager create the exceptional Friday booking", async () => {
    await clearCollections();
    const id = await createBookingServer(db, { ...BASE_INPUT, date: FRIDAY_DATE }, MANAGER);
    const snap = await db.collection("bookings").doc(id).get();
    expect(snap.exists).toBe(true);
    expect(snap.data()?.date).toBe(FRIDAY_DATE);
  });

  it("materializeOccurrenceBookingServer (used only for recurring materialization) still enforces the Friday restriction for a non-manager actor, defense in depth", async () => {
    // Not reachable via any current UI path (recurring schedules can never
    // fall on a Friday — see InvalidRecurringDayError), but the shared core
    // logic must still hold the line if that ever changes.
    await clearCollections();
    await expect(
      materializeOccurrenceBookingServer(db, { ...BASE_INPUT, date: FRIDAY_DATE }, EMPLOYEE)
    ).rejects.toThrow(FridayRestrictedError);
  });
});

describe("updateBookingServer — manager only, including moving a booking (date/shift/worker)", () => {
  it("rejects an employee from editing a booking at all", async () => {
    await clearCollections();
    const id = await createBookingServer(db, { ...BASE_INPUT, date: WEEKDAY_DATE }, MANAGER);

    await expect(
      updateBookingServer(
        db,
        id,
        {
          areaId: BASE_INPUT.areaId,
          areaName: "الرفاع",
          hours: 6,
          amount: 18,
          customerPhone: BASE_INPUT.customerPhone,
          customerLocation: BASE_INPUT.customerLocation,
        },
        EMPLOYEE
      )
    ).rejects.toThrow(ServiceError);

    const snap = await db.collection("bookings").doc(id).get();
    expect(snap.data()?.areaName).toBe(BASE_INPUT.areaName); // unchanged
  });

  it("lets a manager move a booking onto a Friday date", async () => {
    await clearCollections();
    const id = await createBookingServer(db, { ...BASE_INPUT, date: WEEKDAY_DATE }, MANAGER);

    await updateBookingServer(
      db,
      id,
      {
        areaId: BASE_INPUT.areaId,
        areaName: BASE_INPUT.areaName,
        hours: BASE_INPUT.hours,
        amount: BASE_INPUT.amount,
        customerPhone: BASE_INPUT.customerPhone,
        customerLocation: BASE_INPUT.customerLocation,
        date: FRIDAY_DATE,
      },
      MANAGER
    );

    const snap = await db.collection("bookings").doc(id).get();
    expect(snap.data()?.date).toBe(FRIDAY_DATE);
  });

  it("lets a manager change the assigned worker ('Change worker')", async () => {
    await clearCollections();
    const id = await createBookingServer(db, { ...BASE_INPUT, date: WEEKDAY_DATE }, MANAGER);

    await updateBookingServer(
      db,
      id,
      {
        areaId: BASE_INPUT.areaId,
        areaName: BASE_INPUT.areaName,
        hours: BASE_INPUT.hours,
        amount: BASE_INPUT.amount,
        customerPhone: BASE_INPUT.customerPhone,
        customerLocation: BASE_INPUT.customerLocation,
        workerId: "w2",
        workerName: "منى",
      },
      MANAGER
    );

    const snap = await db.collection("bookings").doc(id).get();
    expect(snap.data()?.workerId).toBe("w2");
    expect(snap.data()?.workerName).toBe("منى");
    const oldSlot = await db.collection("slots").doc(`w1_${WEEKDAY_DATE}_morning`).get();
    const newSlot = await db.collection("slots").doc(`w2_${WEEKDAY_DATE}_morning`).get();
    expect(oldSlot.exists).toBe(false);
    expect(newSlot.exists).toBe(true);
  });
});

describe("createBookingServer — area is a required free-typed string, not a managed reference", () => {
  it("rejects a booking with an empty area and writes nothing", async () => {
    await clearCollections();
    await expect(
      createBookingServer(db, { ...BASE_INPUT, areaId: "", areaName: "" }, MANAGER)
    ).rejects.toThrow(ServiceError);
    const bookings = await db.collection("bookings").get();
    expect(bookings.size).toBe(0);
  });

  it("accepts any manually typed area name, with no dependency on a managed areas collection", async () => {
    await clearCollections();
    const id = await createBookingServer(
      db,
      { ...BASE_INPUT, areaId: "الرفاع", areaName: "الرفاع" },
      MANAGER
    );
    const snap = await db.collection("bookings").doc(id).get();
    expect(snap.data()?.areaName).toBe("الرفاع");
  });
});

describe("createBookingServer — double-booking prevention", () => {
  it("rejects a second booking for the same worker/date/shift", async () => {
    await clearCollections();
    await createBookingServer(db, { ...BASE_INPUT, date: WEEKDAY_DATE }, MANAGER);
    await expect(createBookingServer(db, { ...BASE_INPUT, date: WEEKDAY_DATE }, MANAGER)).rejects.toThrow(
      BookingConflictError
    );
  });

  it("resolves two concurrent booking attempts for the same slot with exactly one winner", async () => {
    await clearCollections();
    const results = await Promise.allSettled([
      createBookingServer(db, { ...BASE_INPUT, date: ANOTHER_WEEKDAY_DATE }, MANAGER),
      createBookingServer(db, { ...BASE_INPUT, date: ANOTHER_WEEKDAY_DATE }, MANAGER),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);

    const active = await db
      .collection("bookings")
      .where("date", "==", ANOTHER_WEEKDAY_DATE)
      .where("status", "==", "active")
      .get();
    expect(active.size).toBe(1);
  });
});

describe("cancelBookingServer — manager only, releases availability", () => {
  it("rejects an employee from cancelling a booking", async () => {
    await clearCollections();
    const id = await createBookingServer(db, { ...BASE_INPUT, date: WEEKDAY_DATE }, MANAGER);
    await expect(
      cancelBookingServer(db, id, { reason: null, cancelScope: "single" }, EMPLOYEE)
    ).rejects.toThrow(ServiceError);
    const snap = await db.collection("bookings").doc(id).get();
    expect(snap.data()?.status).toBe("active");
  });

  it("deletes the slot lock so the worker becomes bookable again", async () => {
    await clearCollections();
    const id = await createBookingServer(db, { ...BASE_INPUT, date: WEEKDAY_DATE }, MANAGER);

    await cancelBookingServer(db, id, { reason: null, cancelScope: "single" }, MANAGER);

    const slotSnap = await db.collection("slots").doc(`w1_${WEEKDAY_DATE}_morning`).get();
    expect(slotSnap.exists).toBe(false);

    const newId = await createBookingServer(db, { ...BASE_INPUT, date: WEEKDAY_DATE }, MANAGER);
    expect(newId).toBeTruthy();
  });
});

describe("updateBookingPaymentServer — payment lifecycle", () => {
  it("defaults a new booking to unpaid with null payment fields", async () => {
    await clearCollections();
    const id = await createBookingServer(db, { ...BASE_INPUT, date: WEEKDAY_DATE }, MANAGER);
    const snap = await db.collection("bookings").doc(id).get();
    expect(snap.data()?.paid).toBe(false);
    expect(snap.data()?.paymentMethod).toBeNull();
    expect(snap.data()?.paidAmount).toBeNull();
    expect(snap.data()?.paymentDate).toBeNull();
    expect(snap.data()?.paymentBy).toBeNull();
  });

  it("records who marked the booking paid, the amount, and an auto payment date", async () => {
    await clearCollections();
    const id = await createBookingServer(db, { ...BASE_INPUT, date: WEEKDAY_DATE }, MANAGER);

    let unpaid = await db.collection("bookings").where("paid", "==", false).get();
    expect(unpaid.size).toBe(1);

    await updateBookingPaymentServer(
      db,
      id,
      { isPaid: true, paymentMethod: "benefit", paidAmount: 12 },
      MANAGER
    );

    unpaid = await db.collection("bookings").where("paid", "==", false).get();
    expect(unpaid.size).toBe(0);
    const snap = await db.collection("bookings").doc(id).get();
    expect(snap.data()?.paid).toBe(true);
    expect(snap.data()?.paymentMethod).toBe("benefit");
    expect(snap.data()?.paidAmount).toBe(12);
    expect(snap.data()?.paymentBy).toBe(MANAGER.uid);
    expect(snap.data()?.paymentDate).not.toBeNull();
  });

  it("rejects marking paid without a payment method", async () => {
    await clearCollections();
    const id = await createBookingServer(db, { ...BASE_INPUT, date: WEEKDAY_DATE }, MANAGER);
    await expect(
      updateBookingPaymentServer(db, id, { isPaid: true, paymentMethod: null, paidAmount: 12 }, MANAGER)
    ).rejects.toThrow(ServiceError);
  });

  it("rejects a negative paid amount", async () => {
    await clearCollections();
    const id = await createBookingServer(db, { ...BASE_INPUT, date: WEEKDAY_DATE }, MANAGER);
    await expect(
      updateBookingPaymentServer(db, id, { isPaid: true, paymentMethod: "cash", paidAmount: -5 }, MANAGER)
    ).rejects.toThrow(ServiceError);
  });

  it("rejects a non-manager from touching payment at all", async () => {
    await clearCollections();
    const id = await createBookingServer(db, { ...BASE_INPUT, date: WEEKDAY_DATE }, MANAGER);
    await expect(
      updateBookingPaymentServer(db, id, { isPaid: true, paymentMethod: "cash", paidAmount: 12 }, EMPLOYEE)
    ).rejects.toThrow(ServiceError);
    const snap = await db.collection("bookings").doc(id).get();
    expect(snap.data()?.paid).toBe(false);
  });

  it("keeps the original payment date when only the method or amount changes", async () => {
    await clearCollections();
    const id = await createBookingServer(db, { ...BASE_INPUT, date: WEEKDAY_DATE }, MANAGER);
    await updateBookingPaymentServer(db, id, { isPaid: true, paymentMethod: "cash", paidAmount: 12 }, MANAGER);
    const firstSnap = await db.collection("bookings").doc(id).get();
    const firstPaymentDate = firstSnap.data()?.paymentDate;

    await updateBookingPaymentServer(db, id, { isPaid: true, paymentMethod: "benefit", paidAmount: 15 }, MANAGER);
    const secondSnap = await db.collection("bookings").doc(id).get();
    expect(secondSnap.data()?.paymentMethod).toBe("benefit");
    expect(secondSnap.data()?.paidAmount).toBe(15);
    expect(secondSnap.data()?.paymentDate).toEqual(firstPaymentDate);
  });

  it("clears payment method, amount, and payment date when reverted to unpaid", async () => {
    await clearCollections();
    const id = await createBookingServer(db, { ...BASE_INPUT, date: WEEKDAY_DATE }, MANAGER);
    await updateBookingPaymentServer(db, id, { isPaid: true, paymentMethod: "cash", paidAmount: 12 }, MANAGER);

    await updateBookingPaymentServer(db, id, { isPaid: false, paymentMethod: null, paidAmount: null }, MANAGER);
    const snap = await db.collection("bookings").doc(id).get();
    expect(snap.data()?.paid).toBe(false);
    expect(snap.data()?.paymentMethod).toBeNull();
    expect(snap.data()?.paidAmount).toBeNull();
    expect(snap.data()?.paymentDate).toBeNull();
  });

  it("logs payment_marked_paid, payment_method_changed, payment_amount_changed, and payment_reverted", async () => {
    await clearCollections();
    const id = await createBookingServer(db, { ...BASE_INPUT, date: WEEKDAY_DATE }, MANAGER);

    await updateBookingPaymentServer(db, id, { isPaid: true, paymentMethod: "cash", paidAmount: 12 }, MANAGER);
    await updateBookingPaymentServer(db, id, { isPaid: true, paymentMethod: "benefit", paidAmount: 20 }, MANAGER);
    await updateBookingPaymentServer(db, id, { isPaid: false, paymentMethod: null, paidAmount: null }, MANAGER);

    const logsSnap = await db.collection("activityLogs").where("entityId", "==", id).get();
    const types = logsSnap.docs.map((d) => d.data().type as string).sort();
    expect(types).toEqual(
      [
        "booking_created",
        "payment_amount_changed",
        "payment_marked_paid",
        "payment_method_changed",
        "payment_reverted",
      ].sort()
    );
  });
});

describe("updateBookingRouteStatusServer — the one write an employee is allowed to make", () => {
  it("lets an employee mark a booking dropped off", async () => {
    await clearCollections();
    const id = await createBookingServer(db, { ...BASE_INPUT, date: WEEKDAY_DATE }, MANAGER);

    await updateBookingRouteStatusServer(db, id, "drop_off", EMPLOYEE);

    const snap = await db.collection("bookings").doc(id).get();
    expect(snap.data()?.dropOffAt).not.toBeNull();
    expect(snap.data()?.pickupAt).toBeNull();
  });

  it("lets an employee mark a booking picked up, only after drop-off", async () => {
    await clearCollections();
    const id = await createBookingServer(db, { ...BASE_INPUT, date: WEEKDAY_DATE }, MANAGER);

    await expect(updateBookingRouteStatusServer(db, id, "pickup", EMPLOYEE)).rejects.toThrow(ServiceError);

    await updateBookingRouteStatusServer(db, id, "drop_off", EMPLOYEE);
    await updateBookingRouteStatusServer(db, id, "pickup", EMPLOYEE);

    const snap = await db.collection("bookings").doc(id).get();
    expect(snap.data()?.pickupAt).not.toBeNull();
  });

  it("rejects marking drop-off twice, or pickup twice", async () => {
    await clearCollections();
    const id = await createBookingServer(db, { ...BASE_INPUT, date: WEEKDAY_DATE }, MANAGER);
    await updateBookingRouteStatusServer(db, id, "drop_off", EMPLOYEE);
    await expect(updateBookingRouteStatusServer(db, id, "drop_off", EMPLOYEE)).rejects.toThrow(ServiceError);

    await updateBookingRouteStatusServer(db, id, "pickup", EMPLOYEE);
    await expect(updateBookingRouteStatusServer(db, id, "pickup", EMPLOYEE)).rejects.toThrow(ServiceError);
  });

  it("rejects an employee from resetting drop-off or pickup — manager only", async () => {
    await clearCollections();
    const id = await createBookingServer(db, { ...BASE_INPUT, date: WEEKDAY_DATE }, MANAGER);
    await updateBookingRouteStatusServer(db, id, "drop_off", EMPLOYEE);

    await expect(updateBookingRouteStatusServer(db, id, "reset_drop_off", EMPLOYEE)).rejects.toThrow(ServiceError);
    const snap = await db.collection("bookings").doc(id).get();
    expect(snap.data()?.dropOffAt).not.toBeNull(); // unchanged
  });

  it("lets a manager reset drop-off, which also clears pickup", async () => {
    await clearCollections();
    const id = await createBookingServer(db, { ...BASE_INPUT, date: WEEKDAY_DATE }, MANAGER);
    await updateBookingRouteStatusServer(db, id, "drop_off", EMPLOYEE);
    await updateBookingRouteStatusServer(db, id, "pickup", EMPLOYEE);

    await updateBookingRouteStatusServer(db, id, "reset_drop_off", MANAGER);

    const snap = await db.collection("bookings").doc(id).get();
    expect(snap.data()?.dropOffAt).toBeNull();
    expect(snap.data()?.pickupAt).toBeNull();
  });

  it("lets a manager reset pickup alone, keeping drop-off intact", async () => {
    await clearCollections();
    const id = await createBookingServer(db, { ...BASE_INPUT, date: WEEKDAY_DATE }, MANAGER);
    await updateBookingRouteStatusServer(db, id, "drop_off", EMPLOYEE);
    await updateBookingRouteStatusServer(db, id, "pickup", EMPLOYEE);

    await updateBookingRouteStatusServer(db, id, "reset_pickup", MANAGER);

    const snap = await db.collection("bookings").doc(id).get();
    expect(snap.data()?.dropOffAt).not.toBeNull();
    expect(snap.data()?.pickupAt).toBeNull();
  });
});

describe("setRecurringOccurrencePaymentServer — per-occurrence independence", () => {
  it("paying one occurrence does not mark a future occurrence of the same series as paid", async () => {
    await clearCollections();
    const recurringId = await createRecurringScheduleServer(
      db,
      {
        workerId: "w1",
        workerName: "سارة",
        areaId: "a1",
        areaName: "المنامة",
        shift: "morning",
        dayOfWeek: 3,
        hours: 4,
        amount: 12,
        customerPhone: "",
        customerLocation: "",
        startDate: "2026-07-01",
      },
      MANAGER
    );
    const scheduleSnap = await db.collection("recurringSchedules").doc(recurringId).get();
    const schedule = { id: recurringId, ...scheduleSnap.data() } as RecurringSchedule;

    await setRecurringOccurrencePaymentServer(
      db,
      {
        recurring: schedule,
        date: "2026-08-05", // a Wednesday matching the pattern
        payment: { isPaid: true, paymentMethod: "cash", paidAmount: 12 },
      },
      MANAGER
    );

    const paidOccurrence = await db
      .collection("bookings")
      .where("recurringSeriesId", "==", recurringId)
      .where("date", "==", "2026-08-05")
      .get();
    expect(paidOccurrence.docs[0].data().paid).toBe(true);

    // The next week's occurrence is not yet materialized at all, and remains
    // unpaid by construction — paying one occurrence must never create or
    // affect any document for another date.
    const nextWeekOccurrence = await db
      .collection("bookings")
      .where("recurringSeriesId", "==", recurringId)
      .where("date", "==", "2026-08-12")
      .get();
    expect(nextWeekOccurrence.empty).toBe(true);
  });

  it("rejects a non-manager from setting recurring-occurrence payment", async () => {
    await clearCollections();
    const recurringId = await createRecurringScheduleServer(
      db,
      {
        workerId: "w1",
        workerName: "سارة",
        areaId: "a1",
        areaName: "المنامة",
        shift: "morning",
        dayOfWeek: 3,
        hours: 4,
        amount: 12,
        customerPhone: "",
        customerLocation: "",
        startDate: "2026-07-01",
      },
      MANAGER
    );
    const scheduleSnap = await db.collection("recurringSchedules").doc(recurringId).get();
    const schedule = { id: recurringId, ...scheduleSnap.data() } as RecurringSchedule;

    await expect(
      setRecurringOccurrencePaymentServer(
        db,
        { recurring: schedule, date: "2026-08-05", payment: { isPaid: true, paymentMethod: "cash", paidAmount: 12 } },
        EMPLOYEE
      )
    ).rejects.toThrow(ServiceError);
  });
});

describe("setRecurringOccurrenceRouteStatusServer — materializes on demand for an employee", () => {
  it("lets an employee mark a not-yet-materialized recurring occurrence dropped off, creating exactly one booking for that date", async () => {
    await clearCollections();
    const recurringId = await createRecurringScheduleServer(
      db,
      {
        workerId: "w1",
        workerName: "سارة",
        areaId: "a1",
        areaName: "المنامة",
        shift: "morning",
        dayOfWeek: 3,
        hours: 4,
        amount: 12,
        customerPhone: "",
        customerLocation: "",
        startDate: "2026-07-01",
      },
      MANAGER
    );
    const scheduleSnap = await db.collection("recurringSchedules").doc(recurringId).get();
    const schedule = { id: recurringId, ...scheduleSnap.data() } as RecurringSchedule;

    await setRecurringOccurrenceRouteStatusServer(
      db,
      { recurring: schedule, date: "2026-08-05", action: "drop_off" },
      EMPLOYEE
    );

    const occurrenceSnap = await db
      .collection("bookings")
      .where("recurringSeriesId", "==", recurringId)
      .where("date", "==", "2026-08-05")
      .get();
    expect(occurrenceSnap.size).toBe(1);
    expect(occurrenceSnap.docs[0].data().dropOffAt).not.toBeNull();

    const nextWeekSnap = await db
      .collection("bookings")
      .where("recurringSeriesId", "==", recurringId)
      .where("date", "==", "2026-08-12")
      .get();
    expect(nextWeekSnap.empty).toBe(true);
  });

  it("rejects an employee from resetting a recurring occurrence's route status", async () => {
    await clearCollections();
    const recurringId = await createRecurringScheduleServer(
      db,
      {
        workerId: "w1",
        workerName: "سارة",
        areaId: "a1",
        areaName: "المنامة",
        shift: "morning",
        dayOfWeek: 3,
        hours: 4,
        amount: 12,
        customerPhone: "",
        customerLocation: "",
        startDate: "2026-07-01",
      },
      MANAGER
    );
    const scheduleSnap = await db.collection("recurringSchedules").doc(recurringId).get();
    const schedule = { id: recurringId, ...scheduleSnap.data() } as RecurringSchedule;

    await setRecurringOccurrenceRouteStatusServer(
      db,
      { recurring: schedule, date: "2026-08-05", action: "drop_off" },
      EMPLOYEE
    );

    await expect(
      setRecurringOccurrenceRouteStatusServer(
        db,
        { recurring: schedule, date: "2026-08-05", action: "reset_drop_off" },
        EMPLOYEE
      )
    ).rejects.toThrow(ServiceError);
  });
});

describe("recurring schedules — server-side materialization and future availability", () => {
  it("rejects a non-manager from creating a recurring schedule", async () => {
    await clearCollections();
    await expect(
      createRecurringScheduleServer(
        db,
        {
          workerId: "w1",
          workerName: "سارة",
          areaId: "a1",
          areaName: "المنامة",
          shift: "morning",
          dayOfWeek: 3,
          hours: 4,
          amount: 12,
          customerPhone: "",
          customerLocation: "",
          startDate: todayBahrain(),
        },
        EMPLOYEE
      )
    ).rejects.toThrow(ServiceError);
  });

  it("accepts a start date in the past — recurring bookings are not forced to begin today", async () => {
    await clearCollections();
    const pastDate = addDaysToDateStr(todayBahrain(), -365);
    const recurringId = await createRecurringScheduleServer(
      db,
      {
        workerId: "w1",
        workerName: "سارة",
        areaId: "a1",
        areaName: "المنامة",
        shift: "morning",
        dayOfWeek: 3,
        hours: 4,
        amount: 12,
        customerPhone: "",
        customerLocation: "",
        startDate: pastDate,
      },
      MANAGER
    );
    const scheduleSnap = await db.collection("recurringSchedules").doc(recurringId).get();
    expect(scheduleSnap.data()?.startDate).toBe(pastDate);
  });

  it("computes availability for a date months ahead from the schedule alone (no pre-generated documents)", async () => {
    await clearCollections();
    const today = todayBahrain();
    const recurringId = await createRecurringScheduleServer(
      db,
      {
        workerId: "w1",
        workerName: "سارة",
        areaId: "a1",
        areaName: "المنامة",
        shift: "morning",
        dayOfWeek: 3, // Wednesday
        hours: 4,
        amount: 12,
        customerPhone: "",
        customerLocation: "",
        startDate: today,
      },
      MANAGER
    );

    const scheduleSnap = await db.collection("recurringSchedules").doc(recurringId).get();
    const schedule = { id: recurringId, ...scheduleSnap.data() } as RecurringSchedule;
    const worker: Worker = {
      id: "w1",
      name: "سارة",
      phone: "",
      active: true,
      createdAt: null,
      createdBy: "",
      updatedAt: null,
      updatedBy: "",
    };

    let farDate = addDaysToDateStr(today, 182);
    while (new Date(`${farDate}T00:00:00Z`).getUTCDay() !== 3) {
      farDate = addDaysToDateStr(farDate, 1);
    }

    const result = resolveCell(worker, farDate, "morning", [], [schedule], []);
    expect(result.status).toBe("booked");

    const bookingsSnap = await db.collection("bookings").get();
    expect(bookingsSnap.size).toBe(0);
  });

  it("materializes a single-occurrence edit without duplicating future dates", async () => {
    await clearCollections();
    const recurringId = await createRecurringScheduleServer(
      db,
      {
        workerId: "w1",
        workerName: "سارة",
        areaId: "a1",
        areaName: "المنامة",
        shift: "morning",
        dayOfWeek: 3,
        hours: 4,
        amount: 12,
        customerPhone: "",
        customerLocation: "",
        startDate: "2026-07-01",
      },
      MANAGER
    );
    const scheduleSnap = await db.collection("recurringSchedules").doc(recurringId).get();
    const schedule = { id: recurringId, ...scheduleSnap.data() } as RecurringSchedule;

    await editRecurringOccurrenceServer(
      db,
      {
        recurring: schedule,
        date: "2026-08-05", // a Wednesday matching the pattern
        scope: "single",
        fields: {
          areaId: "a2",
          areaName: "الرفاع",
          hours: 5,
          amount: 15,
          customerPhone: "",
          customerLocation: "",
        },
      },
      MANAGER
    );

    const bookingsSnap = await db
      .collection("bookings")
      .where("recurringSeriesId", "==", recurringId)
      .get();
    expect(bookingsSnap.size).toBe(1);
    expect(bookingsSnap.docs[0].data().areaName).toBe("الرفاع");
  });

  it("cancelling a single occurrence adds an exception without affecting other weeks", async () => {
    await clearCollections();
    const recurringId = await createRecurringScheduleServer(
      db,
      {
        workerId: "w1",
        workerName: "سارة",
        areaId: "a1",
        areaName: "المنامة",
        shift: "morning",
        dayOfWeek: 3,
        hours: 4,
        amount: 12,
        customerPhone: "",
        customerLocation: "",
        startDate: "2026-07-01",
      },
      MANAGER
    );
    const scheduleSnap = await db.collection("recurringSchedules").doc(recurringId).get();
    const schedule = { id: recurringId, ...scheduleSnap.data() } as RecurringSchedule;
    const worker: Worker = {
      id: "w1",
      name: "سارة",
      phone: "",
      active: true,
      createdAt: null,
      createdBy: "",
      updatedAt: null,
      updatedBy: "",
    };

    await cancelRecurringOccurrenceServer(
      db,
      { recurring: schedule, date: "2026-08-05", scope: "single", reason: "إجازة العميل" },
      MANAGER
    );

    const exceptionSnap = await db.collection("recurringExceptions").doc(`${recurringId}_2026-08-05`).get();
    expect(exceptionSnap.exists).toBe(true);

    const cancelledDateResult = resolveCell(worker, "2026-08-05", "morning", [], [schedule], [
      { id: exceptionSnap.id, ...exceptionSnap.data() } as never,
    ]);
    expect(cancelledDateResult.status).toBe("available");

    const nextWeekResult = resolveCell(worker, "2026-08-12", "morning", [], [schedule], []);
    expect(nextWeekResult.status).toBe("booked");
  });
});
