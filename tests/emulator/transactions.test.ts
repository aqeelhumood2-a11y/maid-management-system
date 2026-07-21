import {
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { readFileSync } from "node:fs";
import { collection, doc, getDoc, getDocs, query, serverTimestamp, setDoc, where, type Firestore } from "firebase/firestore";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { BookingConflictError, cancelBooking, createBooking, markBookingPaid, updateBookingFields } from "@/lib/booking";
import { resolveCell } from "@/lib/availability";
import { addDaysToDateStr, todayBahrain } from "@/lib/date";
import { cancelRecurringOccurrence, createRecurringSchedule, editRecurringOccurrence } from "@/lib/recurring";
import type { RecurringSchedule, Worker } from "@/lib/types";

const PROJECT_ID = "demo-maid-mgmt-tx";
let testEnv: RulesTestEnvironment;

const MANAGER = { uid: "mgr", email: "mgr@example.com", name: "المدير" };
const EMPLOYEE = { uid: "emp", email: "emp@example.com", name: "الموظفة" };

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync("firestore.rules", "utf8"),
      host: "127.0.0.1",
      port: 8080,
    },
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

afterEach(async () => {
  await testEnv.clearFirestore();
});

async function seedBaseData() {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "users", MANAGER.uid), {
      email: MANAGER.email,
      name: MANAGER.name,
      role: "manager",
      active: true,
      createdAt: serverTimestamp(),
      createdBy: "seed",
      updatedAt: serverTimestamp(),
      updatedBy: "seed",
    });
    await setDoc(doc(db, "users", EMPLOYEE.uid), {
      email: EMPLOYEE.email,
      name: EMPLOYEE.name,
      role: "employee",
      active: true,
      createdAt: serverTimestamp(),
      createdBy: "seed",
      updatedAt: serverTimestamp(),
      updatedBy: "seed",
    });
    await setDoc(doc(db, "workers", "w1"), {
      name: "سارة",
      phone: "3300000",
      active: true,
      createdBy: "seed",
      createdAt: serverTimestamp(),
      updatedBy: "seed",
      updatedAt: serverTimestamp(),
    });
  });
}

// @firebase/rules-unit-testing types firestore() as the compat SDK, but at
// runtime it returns a modular-compatible instance (their own docs use it
// directly with modular doc()/collection()); cast to align with our lib's
// modular Firestore parameter type.
function managerDb(): Firestore {
  return testEnv.authenticatedContext(MANAGER.uid).firestore() as unknown as Firestore;
}
function employeeDb(): Firestore {
  return testEnv.authenticatedContext(EMPLOYEE.uid).firestore() as unknown as Firestore;
}

const BASE_BOOKING_INPUT = {
  date: "2026-08-05", // a Wednesday
  shift: "morning" as const,
  workerId: "w1",
  workerName: "سارة",
  areaId: "a1",
  areaName: "المنامة",
  hours: 4,
  amount: 12,
  paymentMethod: null,
  customerPhone: "36000000",
  customerLocation: "قريب من السوق",
  source: "today" as const,
  recurringSeriesId: null,
};

describe("createBooking — double-booking prevention", () => {
  it("creates a booking and locks the slot", async () => {
    await seedBaseData();
    const db = employeeDb();
    const id = await createBooking(db, { ...BASE_BOOKING_INPUT, actingUser: EMPLOYEE });
    const snap = await getDoc(doc(db, "bookings", id));
    expect(snap.exists()).toBe(true);
    const slotSnap = await getDoc(doc(db, "slots", "w1_2026-08-05_morning"));
    expect(slotSnap.exists()).toBe(true);
  });

  it("rejects a second booking for the same worker/date/shift with the required Arabic message", async () => {
    await seedBaseData();
    const db = employeeDb();
    await createBooking(db, { ...BASE_BOOKING_INPUT, actingUser: EMPLOYEE });

    await expect(createBooking(db, { ...BASE_BOOKING_INPUT, actingUser: EMPLOYEE })).rejects.toThrow(
      BookingConflictError
    );
    await expect(createBooking(db, { ...BASE_BOOKING_INPUT, actingUser: EMPLOYEE })).rejects.toThrow(
      "تم حجز العاملة للتو، اختر عاملة أخرى."
    );
  });

  it("allows booking a different shift on the same date for the same worker", async () => {
    await seedBaseData();
    const db = employeeDb();
    await createBooking(db, { ...BASE_BOOKING_INPUT, actingUser: EMPLOYEE });
    const secondId = await createBooking(db, {
      ...BASE_BOOKING_INPUT,
      shift: "afternoon",
      actingUser: EMPLOYEE,
    });
    expect(secondId).toBeTruthy();
  });

  it("resolves two concurrent booking attempts with exactly one winner", async () => {
    await seedBaseData();
    const db = employeeDb();

    const results = await Promise.allSettled([
      createBooking(db, { ...BASE_BOOKING_INPUT, actingUser: EMPLOYEE }),
      createBooking(db, { ...BASE_BOOKING_INPUT, actingUser: MANAGER }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const activeBookings = await getDocs(
      query(collection(db, "bookings"), where("status", "==", "active"))
    );
    expect(activeBookings.size).toBe(1);
  });
});

describe("cancelBooking — releases availability", () => {
  it("deletes the slot lock so the worker becomes bookable again", async () => {
    await seedBaseData();
    const db = employeeDb();
    const id = await createBooking(db, { ...BASE_BOOKING_INPUT, actingUser: EMPLOYEE });

    await cancelBooking(db, id, { reason: null, actingUser: EMPLOYEE, cancelScope: "single" });

    const slotSnap = await getDoc(doc(db, "slots", "w1_2026-08-05_morning"));
    expect(slotSnap.exists()).toBe(false);

    const newId = await createBooking(db, { ...BASE_BOOKING_INPUT, actingUser: EMPLOYEE });
    expect(newId).toBeTruthy();
  });

  it("excludes cancelled bookings from active-status queries used by reports", async () => {
    await seedBaseData();
    const db = employeeDb();
    const id = await createBooking(db, { ...BASE_BOOKING_INPUT, actingUser: EMPLOYEE });
    await cancelBooking(db, id, { reason: "طلب العميل", actingUser: EMPLOYEE, cancelScope: "single" });

    const activeBookings = await getDocs(
      query(collection(db, "bookings"), where("status", "==", "active"))
    );
    expect(activeBookings.size).toBe(0);

    const cancelledSnap = await getDoc(doc(db, "bookings", id));
    expect(cancelledSnap.data()?.status).toBe("cancelled");
    expect(cancelledSnap.data()?.cancelledReason).toBe("طلب العميل");
  });
});

describe("updateBookingFields", () => {
  it("edits area/hours/amount without touching the worker/date/shift slot", async () => {
    await seedBaseData();
    const db = employeeDb();
    const id = await createBooking(db, { ...BASE_BOOKING_INPUT, actingUser: EMPLOYEE });

    await updateBookingFields(
      db,
      id,
      {
        areaId: "a2",
        areaName: "الرفاع",
        hours: 6,
        amount: 18,
        paymentMethod: "cash",
        customerPhone: "36000001",
        customerLocation: "بجانب المسجد",
      },
      EMPLOYEE
    );

    const snap = await getDoc(doc(db, "bookings", id));
    expect(snap.data()?.areaName).toBe("الرفاع");
    expect(snap.data()?.hours).toBe(6);
    expect(snap.data()?.paid).toBe(true);

    const slotSnap = await getDoc(doc(db, "slots", "w1_2026-08-05_morning"));
    expect(slotSnap.exists()).toBe(true);
  });
});

describe("markBookingPaid — unpaid to paid transition", () => {
  it("lets a manager mark a booking paid and stores the audit trail", async () => {
    await seedBaseData();
    const db = employeeDb();
    const id = await createBooking(db, { ...BASE_BOOKING_INPUT, actingUser: EMPLOYEE });

    const mgrDb = managerDb();
    await markBookingPaid(mgrDb, id, { paymentMethod: "benefit", actingUser: MANAGER });

    const snap = await getDoc(doc(managerDb(), "bookings", id));
    expect(snap.data()?.paid).toBe(true);
    expect(snap.data()?.paymentMethod).toBe("benefit");
    expect(snap.data()?.paymentBy).toBe(MANAGER.uid);
  });

  it("removes the booking from the unpaid set once marked paid", async () => {
    await seedBaseData();
    const db = employeeDb();
    const id = await createBooking(db, { ...BASE_BOOKING_INPUT, actingUser: EMPLOYEE });

    let unpaid = await getDocs(query(collection(db, "bookings"), where("paid", "==", false)));
    expect(unpaid.size).toBe(1);

    await markBookingPaid(managerDb(), id, { paymentMethod: "benefit", actingUser: MANAGER });

    unpaid = await getDocs(query(collection(db, "bookings"), where("paid", "==", false)));
    expect(unpaid.size).toBe(0);
  });
});

describe("recurring schedules — future availability without pre-generating weeks", () => {
  it("computes availability for a date months ahead from the schedule alone", async () => {
    await seedBaseData();
    const mgrDb = managerDb();
    const today = todayBahrain();

    const recurringId = await createRecurringSchedule(mgrDb, {
      workerId: "w1",
      workerName: "سارة",
      areaId: "a1",
      areaName: "المنامة",
      shift: "morning",
      dayOfWeek: 3, // Wednesday
      hours: 4,
      amount: 12,
      paymentMethod: null,
      customerPhone: "",
      customerLocation: "",
      startDate: today,
      actingUser: MANAGER,
    });

    const scheduleSnap = await getDoc(doc(mgrDb, "recurringSchedules", recurringId));
    const schedule = { id: recurringId, ...scheduleSnap.data() } as RecurringSchedule;
    const worker: Worker = { id: "w1", name: "سارة", phone: "", active: true, createdAt: null, createdBy: "", updatedAt: null, updatedBy: "" };

    // Find the next Wednesday at least 6 months out — no booking documents exist for it.
    let farDate = addDaysToDateStr(today, 182);
    while (new Date(`${farDate}T00:00:00Z`).getUTCDay() !== 3) {
      farDate = addDaysToDateStr(farDate, 1);
    }

    const result = resolveCell(worker, farDate, "morning", [], [schedule], []);
    expect(result.status).toBe("booked");
    expect(result.virtualOccurrence?.recurring.id).toBe(recurringId);

    const bookingsSnap = await getDocs(collection(mgrDb, "bookings"));
    expect(bookingsSnap.size).toBe(0);
  });

  it("materializes a single-occurrence edit without duplicating future dates", async () => {
    await seedBaseData();
    const mgrDb = managerDb();
    const recurringId = await createRecurringSchedule(mgrDb, {
      workerId: "w1",
      workerName: "سارة",
      areaId: "a1",
      areaName: "المنامة",
      shift: "morning",
      dayOfWeek: 3,
      hours: 4,
      amount: 12,
      paymentMethod: null,
      customerPhone: "",
      customerLocation: "",
      startDate: "2026-07-01",
      actingUser: MANAGER,
    });
    const scheduleSnap = await getDoc(doc(mgrDb, "recurringSchedules", recurringId));
    const schedule = { id: recurringId, ...scheduleSnap.data() } as RecurringSchedule;

    await editRecurringOccurrence(mgrDb, {
      recurring: schedule,
      date: "2026-08-05", // a Wednesday matching the pattern
      scope: "single",
      fields: {
        areaId: "a2",
        areaName: "الرفاع",
        hours: 5,
        amount: 15,
        paymentMethod: "cash",
        customerPhone: "",
        customerLocation: "",
      },
      actingUser: MANAGER,
    });

    const bookingsSnap = await getDocs(
      query(collection(mgrDb, "bookings"), where("recurringSeriesId", "==", recurringId))
    );
    expect(bookingsSnap.size).toBe(1);
    expect(bookingsSnap.docs[0].data().areaName).toBe("الرفاع");
    expect(bookingsSnap.docs[0].data().hours).toBe(5);
  });

  it("cancelling a single occurrence adds an exception without affecting other weeks", async () => {
    await seedBaseData();
    const mgrDb = managerDb();
    const recurringId = await createRecurringSchedule(mgrDb, {
      workerId: "w1",
      workerName: "سارة",
      areaId: "a1",
      areaName: "المنامة",
      shift: "morning",
      dayOfWeek: 3,
      hours: 4,
      amount: 12,
      paymentMethod: null,
      customerPhone: "",
      customerLocation: "",
      startDate: "2026-07-01",
      actingUser: MANAGER,
    });
    const scheduleSnap = await getDoc(doc(mgrDb, "recurringSchedules", recurringId));
    const schedule = { id: recurringId, ...scheduleSnap.data() } as RecurringSchedule;
    const worker: Worker = { id: "w1", name: "سارة", phone: "", active: true, createdAt: null, createdBy: "", updatedAt: null, updatedBy: "" };

    await cancelRecurringOccurrence(mgrDb, {
      recurring: schedule,
      date: "2026-08-05",
      scope: "single",
      reason: "إجازة العميل",
      actingUser: MANAGER,
    });

    const exceptionSnap = await getDoc(doc(mgrDb, "recurringExceptions", `${recurringId}_2026-08-05`));
    expect(exceptionSnap.exists()).toBe(true);

    const cancelledDateResult = resolveCell(worker, "2026-08-05", "morning", [], [schedule], [
      { id: exceptionSnap.id, ...exceptionSnap.data() } as never,
    ]);
    expect(cancelledDateResult.status).toBe("available");

    // The following week's occurrence is unaffected.
    const nextWeekResult = resolveCell(worker, "2026-08-12", "morning", [], [schedule], []);
    expect(nextWeekResult.status).toBe("booked");
  });
});
