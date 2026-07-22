import { initializeApp, getApps, deleteApp, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  BookingConflictError,
  createBookingServer,
  cancelBookingServer,
  FridayRestrictedError,
  ServiceError,
  updateBookingPaymentServer,
  updateBookingServer,
  type Actor,
} from "@/lib/server/bookingService";
import {
  cancelRecurringOccurrenceServer,
  createRecurringScheduleServer,
  editRecurringOccurrenceServer,
  setRecurringOccurrencePaymentServer,
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
 * authorization decision (in particular, the Friday-exceptional-booking
 * restriction) is enforced in code that a client can never bypass, not by
 * something the client sends. Direct client write rejection is covered
 * separately in tests/emulator/rules.test.ts.
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

describe("createBookingServer — Friday exceptional booking authorization", () => {
  it("lets an employee create a normal weekday booking", async () => {
    await clearCollections();
    const id = await createBookingServer(db, { ...BASE_INPUT, date: WEEKDAY_DATE }, EMPLOYEE);
    const snap = await db.collection("bookings").doc(id).get();
    expect(snap.exists).toBe(true);
    expect(snap.data()?.status).toBe("active");
  });

  it("rejects an employee creating a booking on Friday, and writes nothing", async () => {
    await clearCollections();
    await expect(createBookingServer(db, { ...BASE_INPUT, date: FRIDAY_DATE }, EMPLOYEE)).rejects.toThrow(
      FridayRestrictedError
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

  it("rejects even a well-formed request claiming manager role is irrelevant — the server derives role, not the payload", async () => {
    // The Actor object here stands in for what getServerSession() returns
    // from the verified cookie; nothing about the booking input itself
    // (source, etc.) can influence the authorization decision.
    await clearCollections();
    await expect(
      createBookingServer(db, { ...BASE_INPUT, date: FRIDAY_DATE, source: "manager_future" }, EMPLOYEE)
    ).rejects.toThrow(FridayRestrictedError);
  });
});

describe("updateBookingServer — moving a booking into Friday", () => {
  it("rejects an employee moving an existing booking onto a Friday date", async () => {
    await clearCollections();
    const id = await createBookingServer(db, { ...BASE_INPUT, date: WEEKDAY_DATE }, EMPLOYEE);

    await expect(
      updateBookingServer(
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
        EMPLOYEE
      )
    ).rejects.toThrow(FridayRestrictedError);

    const snap = await db.collection("bookings").doc(id).get();
    expect(snap.data()?.date).toBe(WEEKDAY_DATE); // unchanged
    const fridaySlot = await db.collection("slots").doc(`w1_${FRIDAY_DATE}_morning`).get();
    expect(fridaySlot.exists).toBe(false);
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

  it("still lets an employee edit non-slot fields of a booking a manager already placed on Friday", async () => {
    await clearCollections();
    const id = await createBookingServer(db, { ...BASE_INPUT, date: FRIDAY_DATE }, MANAGER);

    await updateBookingServer(
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
    );

    const snap = await db.collection("bookings").doc(id).get();
    expect(snap.data()?.areaName).toBe("الرفاع");
    expect(snap.data()?.date).toBe(FRIDAY_DATE);
  });
});

describe("createBookingServer — area is a required free-typed string, not a managed reference", () => {
  it("rejects a booking with an empty area and writes nothing", async () => {
    await clearCollections();
    await expect(
      createBookingServer(db, { ...BASE_INPUT, areaId: "", areaName: "" }, EMPLOYEE)
    ).rejects.toThrow(ServiceError);
    const bookings = await db.collection("bookings").get();
    expect(bookings.size).toBe(0);
  });

  it("accepts any manually typed area name, with no dependency on a managed areas collection", async () => {
    await clearCollections();
    const id = await createBookingServer(
      db,
      { ...BASE_INPUT, areaId: "الرفاع", areaName: "الرفاع" },
      EMPLOYEE
    );
    const snap = await db.collection("bookings").doc(id).get();
    expect(snap.data()?.areaName).toBe("الرفاع");
  });
});

describe("createBookingServer — double-booking prevention", () => {
  it("rejects a second booking for the same worker/date/shift", async () => {
    await clearCollections();
    await createBookingServer(db, { ...BASE_INPUT, date: WEEKDAY_DATE }, EMPLOYEE);
    await expect(createBookingServer(db, { ...BASE_INPUT, date: WEEKDAY_DATE }, EMPLOYEE)).rejects.toThrow(
      BookingConflictError
    );
  });

  it("resolves two concurrent booking attempts for the same slot with exactly one winner", async () => {
    await clearCollections();
    const results = await Promise.allSettled([
      createBookingServer(db, { ...BASE_INPUT, date: ANOTHER_WEEKDAY_DATE }, EMPLOYEE),
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

describe("cancelBookingServer — releases availability", () => {
  it("deletes the slot lock so the worker becomes bookable again", async () => {
    await clearCollections();
    const id = await createBookingServer(db, { ...BASE_INPUT, date: WEEKDAY_DATE }, EMPLOYEE);

    await cancelBookingServer(db, id, { reason: null, cancelScope: "single" }, EMPLOYEE);

    const slotSnap = await db.collection("slots").doc(`w1_${WEEKDAY_DATE}_morning`).get();
    expect(slotSnap.exists).toBe(false);

    const newId = await createBookingServer(db, { ...BASE_INPUT, date: WEEKDAY_DATE }, EMPLOYEE);
    expect(newId).toBeTruthy();
  });
});

describe("updateBookingPaymentServer — payment lifecycle", () => {
  it("defaults a new booking to unpaid with null payment fields", async () => {
    await clearCollections();
    const id = await createBookingServer(db, { ...BASE_INPUT, date: WEEKDAY_DATE }, EMPLOYEE);
    const snap = await db.collection("bookings").doc(id).get();
    expect(snap.data()?.paid).toBe(false);
    expect(snap.data()?.paymentMethod).toBeNull();
    expect(snap.data()?.paidAmount).toBeNull();
    expect(snap.data()?.paymentDate).toBeNull();
    expect(snap.data()?.paymentBy).toBeNull();
  });

  it("records who marked the booking paid, the amount, and an auto payment date", async () => {
    await clearCollections();
    const id = await createBookingServer(db, { ...BASE_INPUT, date: WEEKDAY_DATE }, EMPLOYEE);

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
    const id = await createBookingServer(db, { ...BASE_INPUT, date: WEEKDAY_DATE }, EMPLOYEE);
    await expect(
      updateBookingPaymentServer(db, id, { isPaid: true, paymentMethod: null, paidAmount: 12 }, MANAGER)
    ).rejects.toThrow(ServiceError);
  });

  it("rejects a negative paid amount", async () => {
    await clearCollections();
    const id = await createBookingServer(db, { ...BASE_INPUT, date: WEEKDAY_DATE }, EMPLOYEE);
    await expect(
      updateBookingPaymentServer(db, id, { isPaid: true, paymentMethod: "cash", paidAmount: -5 }, MANAGER)
    ).rejects.toThrow(ServiceError);
  });

  it("rejects a non-manager from touching payment at all", async () => {
    await clearCollections();
    const id = await createBookingServer(db, { ...BASE_INPUT, date: WEEKDAY_DATE }, EMPLOYEE);
    await expect(
      updateBookingPaymentServer(db, id, { isPaid: true, paymentMethod: "cash", paidAmount: 12 }, EMPLOYEE)
    ).rejects.toThrow(ServiceError);
    const snap = await db.collection("bookings").doc(id).get();
    expect(snap.data()?.paid).toBe(false);
  });

  it("keeps the original payment date when only the method or amount changes", async () => {
    await clearCollections();
    const id = await createBookingServer(db, { ...BASE_INPUT, date: WEEKDAY_DATE }, EMPLOYEE);
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
    const id = await createBookingServer(db, { ...BASE_INPUT, date: WEEKDAY_DATE }, EMPLOYEE);
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
    const id = await createBookingServer(db, { ...BASE_INPUT, date: WEEKDAY_DATE }, EMPLOYEE);

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
