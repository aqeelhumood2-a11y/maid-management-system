import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { readFileSync } from "node:fs";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";

const PROJECT_ID = "demo-maid-mgmt-rules";

let testEnv: RulesTestEnvironment;

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

async function seedUser(uid: string, role: "employee" | "manager", active = true) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "users", uid), {
      email: `${uid}@example.com`,
      name: uid,
      role,
      active,
      createdAt: serverTimestamp(),
      createdBy: "seed",
      updatedAt: serverTimestamp(),
      updatedBy: "seed",
    });
  });
}

async function seedWorker(id: string, active = true) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "workers", id), {
      name: "عاملة تجريبية",
      phone: "3300000",
      active,
      createdBy: "seed",
      createdAt: serverTimestamp(),
      updatedBy: "seed",
      updatedAt: serverTimestamp(),
    });
  });
}

describe("users collection", () => {
  it("denies all client writes, even by a manager (accounts are managed server-side only)", async () => {
    await seedUser("mgr1", "manager");
    const mgrDb = testEnv.authenticatedContext("mgr1").firestore();
    await assertFails(setDoc(doc(mgrDb, "users", "newuser"), { email: "x", name: "x", role: "manager", active: true }));
  });

  it("prevents a user from self-promoting by editing their own doc", async () => {
    await seedUser("emp1", "employee");
    const empDb = testEnv.authenticatedContext("emp1").firestore();
    await assertFails(updateDoc(doc(empDb, "users", "emp1"), { role: "manager" }));
  });

  it("lets a user read their own profile but not another user's", async () => {
    await seedUser("emp2", "employee");
    await seedUser("emp2b", "employee");
    const empDb = testEnv.authenticatedContext("emp2").firestore();
    await assertSucceeds(getDoc(doc(empDb, "users", "emp2")));
    await assertFails(getDoc(doc(empDb, "users", "emp2b")));
  });

  it("denies reads for an unauthenticated client", async () => {
    const anonDb = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDocs(collection(anonDb, "workers")));
  });
});

describe("workers collection — manager-only writes", () => {
  it("allows a manager to create a worker", async () => {
    await seedUser("mgr2", "manager");
    const mgrDb = testEnv.authenticatedContext("mgr2").firestore();
    await assertSucceeds(
      addDoc(collection(mgrDb, "workers"), {
        name: "فاطمة",
        phone: "3300001",
        active: true,
        createdBy: "mgr2",
        createdAt: serverTimestamp(),
        updatedBy: "mgr2",
        updatedAt: serverTimestamp(),
      })
    );
  });

  it("denies an employee from creating a worker", async () => {
    await seedUser("emp3", "employee");
    const empDb = testEnv.authenticatedContext("emp3").firestore();
    await assertFails(
      addDoc(collection(empDb, "workers"), {
        name: "فاطمة",
        phone: "3300001",
        active: true,
        createdBy: "emp3",
        createdAt: serverTimestamp(),
        updatedBy: "emp3",
        updatedAt: serverTimestamp(),
      })
    );
  });

  it("denies writes from a deactivated manager account", async () => {
    await seedUser("mgr3", "manager", false);
    const mgrDb = testEnv.authenticatedContext("mgr3").firestore();
    await assertFails(
      addDoc(collection(mgrDb, "workers"), {
        name: "فاطمة",
        phone: "3300001",
        active: true,
        createdBy: "mgr3",
        createdAt: serverTimestamp(),
        updatedBy: "mgr3",
        updatedAt: serverTimestamp(),
      })
    );
  });

  it("both roles can read the worker list", async () => {
    await seedUser("emp4", "employee");
    await seedWorker("w1");
    const empDb = testEnv.authenticatedContext("emp4").firestore();
    await assertSucceeds(getDocs(collection(empDb, "workers")));
  });
});

describe("slots collection — double-booking lock", () => {
  it("allows creating a slot that doesn't exist yet", async () => {
    await seedUser("emp5", "employee");
    const empDb = testEnv.authenticatedContext("emp5").firestore();
    await assertSucceeds(
      setDoc(doc(empDb, "slots", "w1_2026-07-22_morning"), {
        bookingId: "b1",
        workerId: "w1",
        date: "2026-07-22",
        shift: "morning",
        createdAt: serverTimestamp(),
      })
    );
  });

  it("rejects overwriting an existing slot (the write becomes an update, which is always denied)", async () => {
    await seedUser("emp6", "employee");
    const empDb = testEnv.authenticatedContext("emp6").firestore();
    const slotRef = doc(empDb, "slots", "w1_2026-07-23_morning");
    await assertSucceeds(
      setDoc(slotRef, { bookingId: "b1", workerId: "w1", date: "2026-07-23", shift: "morning", createdAt: serverTimestamp() })
    );
    await assertFails(
      setDoc(slotRef, { bookingId: "b2", workerId: "w1", date: "2026-07-23", shift: "morning", createdAt: serverTimestamp() })
    );
  });

  it("allows deleting a slot to release it", async () => {
    await seedUser("emp7", "employee");
    const empDb = testEnv.authenticatedContext("emp7").firestore();
    const slotRef = doc(empDb, "slots", "w1_2026-07-24_afternoon");
    await setDoc(slotRef, { bookingId: "b1", workerId: "w1", date: "2026-07-24", shift: "afternoon", createdAt: serverTimestamp() });
    await assertSucceeds(deleteDoc(slotRef));
  });
});

describe("bookings collection", () => {
  it("allows an employee to create a valid active booking", async () => {
    await seedUser("emp8", "employee");
    const empDb = testEnv.authenticatedContext("emp8").firestore();
    await assertSucceeds(
      addDoc(collection(empDb, "bookings"), {
        date: "2026-07-22",
        shift: "morning",
        workerId: "w1",
        workerName: "عاملة",
        areaId: "a1",
        areaName: "منطقة",
        hours: 4,
        amount: 10,
        paymentMethod: null,
        paid: false,
        paymentDate: null,
        paymentBy: null,
        customerPhone: "",
        customerLocation: "",
        source: "today",
        recurringSeriesId: null,
        status: "active",
        cancelledAt: null,
        cancelledBy: null,
        cancelledReason: null,
        cancelScope: null,
        createdBy: "emp8",
        createdAt: serverTimestamp(),
        updatedBy: "emp8",
        updatedAt: serverTimestamp(),
      })
    );
  });

  it("rejects a booking with an invalid shift value", async () => {
    await seedUser("emp9", "employee");
    const empDb = testEnv.authenticatedContext("emp9").firestore();
    await assertFails(
      addDoc(collection(empDb, "bookings"), {
        date: "2026-07-22",
        shift: "night",
        workerId: "w1",
        areaId: "a1",
        hours: 4,
        amount: 10,
        paymentMethod: null,
        paid: false,
        source: "today",
        status: "active",
        createdBy: "emp9",
        createdAt: serverTimestamp(),
        updatedBy: "emp9",
        updatedAt: serverTimestamp(),
      })
    );
  });

  it("rejects forging createdBy to someone else", async () => {
    await seedUser("emp10", "employee");
    const empDb = testEnv.authenticatedContext("emp10").firestore();
    await assertFails(
      addDoc(collection(empDb, "bookings"), {
        date: "2026-07-22",
        shift: "morning",
        workerId: "w1",
        areaId: "a1",
        hours: 4,
        amount: 10,
        paymentMethod: null,
        paid: false,
        source: "today",
        status: "active",
        createdBy: "someone-else",
        createdAt: serverTimestamp(),
        updatedBy: "emp10",
        updatedAt: serverTimestamp(),
      })
    );
  });

  it("lets either role transition a booking from unpaid to paid and records who did it", async () => {
    // The dedicated "Mark Paid" workflow lives on the Unpaid Bookings page, which
    // is manager-only via route protection — Firestore rules validate the field
    // shape here, the same as any other booking edit (employees also set payment
    // method through the regular Today/Weekly edit flow).
    await seedUser("emp11", "employee");
    const empDb = testEnv.authenticatedContext("emp11").firestore();

    const bookingData = {
      date: "2026-07-22",
      shift: "morning",
      workerId: "w1",
      workerName: "w",
      areaId: "a1",
      areaName: "a",
      hours: 4,
      amount: 10,
      paymentMethod: null,
      paid: false,
      paymentDate: null,
      paymentBy: null,
      customerPhone: "",
      customerLocation: "",
      source: "today",
      recurringSeriesId: null,
      status: "active",
      cancelledAt: null,
      cancelledBy: null,
      cancelledReason: null,
      cancelScope: null,
      createdBy: "emp11",
      createdAt: serverTimestamp(),
      updatedBy: "emp11",
      updatedAt: serverTimestamp(),
    };
    const ref = await assertSucceeds(addDoc(collection(empDb, "bookings"), bookingData));

    await assertSucceeds(
      updateDoc(doc(empDb, "bookings", ref.id), {
        paid: true,
        paymentMethod: "cash",
        paymentDate: serverTimestamp(),
        paymentBy: "emp11",
        updatedBy: "emp11",
        updatedAt: serverTimestamp(),
      })
    );

    const snap = await getDoc(doc(empDb, "bookings", ref.id));
    expect(snap.data()?.paymentBy).toBe("emp11");
  });

  it("never allows deleting a booking (only cancellation via status)", async () => {
    await seedUser("mgr5", "manager");
    const mgrDb = testEnv.authenticatedContext("mgr5").firestore();
    const ref = await assertSucceeds(
      addDoc(collection(mgrDb, "bookings"), {
        date: "2026-07-22",
        shift: "morning",
        workerId: "w1",
        areaId: "a1",
        hours: 4,
        amount: 10,
        paymentMethod: null,
        paid: false,
        source: "manager_future",
        status: "active",
        createdBy: "mgr5",
        createdAt: serverTimestamp(),
        updatedBy: "mgr5",
        updatedAt: serverTimestamp(),
      })
    );
    await assertFails(deleteDoc(doc(mgrDb, "bookings", ref.id)));
  });
});

describe("recurringSchedules & recurringExceptions — manager-only", () => {
  it("denies an employee from creating a recurring schedule", async () => {
    await seedUser("emp12", "employee");
    const empDb = testEnv.authenticatedContext("emp12").firestore();
    await assertFails(
      addDoc(collection(empDb, "recurringSchedules"), {
        workerId: "w1",
        shift: "morning",
        dayOfWeek: 2,
        hours: 4,
        amount: 10,
        status: "active",
        createdBy: "emp12",
        createdAt: serverTimestamp(),
        updatedBy: "emp12",
        updatedAt: serverTimestamp(),
      })
    );
  });

  it("rejects a recurring schedule on Friday (dayOfWeek 5)", async () => {
    await seedUser("mgr6", "manager");
    const mgrDb = testEnv.authenticatedContext("mgr6").firestore();
    await assertFails(
      addDoc(collection(mgrDb, "recurringSchedules"), {
        workerId: "w1",
        shift: "morning",
        dayOfWeek: 5,
        hours: 4,
        amount: 10,
        status: "active",
        createdBy: "mgr6",
        createdAt: serverTimestamp(),
        updatedBy: "mgr6",
        updatedAt: serverTimestamp(),
      })
    );
  });

  it("allows a manager to create a valid recurring schedule", async () => {
    await seedUser("mgr7", "manager");
    const mgrDb = testEnv.authenticatedContext("mgr7").firestore();
    await assertSucceeds(
      addDoc(collection(mgrDb, "recurringSchedules"), {
        workerId: "w1",
        shift: "morning",
        dayOfWeek: 2,
        hours: 4,
        amount: 10,
        status: "active",
        createdBy: "mgr7",
        createdAt: serverTimestamp(),
        updatedBy: "mgr7",
        updatedAt: serverTimestamp(),
      })
    );
  });
});

describe("activityLogs — append-only, manager-readable only", () => {
  it("allows any active authenticated user to append a log entry for their own action", async () => {
    await seedUser("emp13", "employee");
    const empDb = testEnv.authenticatedContext("emp13").firestore();
    await assertSucceeds(
      addDoc(collection(empDb, "activityLogs"), {
        type: "booking_created",
        entityType: "booking",
        entityId: "b1",
        actingUid: "emp13",
        actingEmail: "emp13@example.com",
        actingName: "emp13",
        before: null,
        after: null,
        createdAt: serverTimestamp(),
      })
    );
  });

  it("rejects logging an action under a different user's identity", async () => {
    await seedUser("emp14", "employee");
    const empDb = testEnv.authenticatedContext("emp14").firestore();
    await assertFails(
      addDoc(collection(empDb, "activityLogs"), {
        type: "booking_created",
        entityType: "booking",
        entityId: "b1",
        actingUid: "someone-else",
        actingEmail: "x",
        actingName: "x",
        before: null,
        after: null,
        createdAt: serverTimestamp(),
      })
    );
  });

  it("denies an employee from reading activity logs", async () => {
    await seedUser("emp15", "employee");
    const empDb = testEnv.authenticatedContext("emp15").firestore();
    await assertFails(getDocs(collection(empDb, "activityLogs")));
  });

  it("allows a manager to read activity logs", async () => {
    await seedUser("mgr8", "manager");
    const mgrDb = testEnv.authenticatedContext("mgr8").firestore();
    await assertSucceeds(getDocs(collection(mgrDb, "activityLogs")));
  });

  it("never allows editing or deleting a log entry", async () => {
    await seedUser("mgr9", "manager");
    const mgrDb = testEnv.authenticatedContext("mgr9").firestore();
    const ref = await assertSucceeds(
      addDoc(collection(mgrDb, "activityLogs"), {
        type: "login",
        entityType: "user",
        entityId: "mgr9",
        actingUid: "mgr9",
        actingEmail: "mgr9@example.com",
        actingName: "mgr9",
        before: null,
        after: null,
        createdAt: serverTimestamp(),
      })
    );
    await assertFails(updateDoc(doc(mgrDb, "activityLogs", ref.id), { type: "login" }));
    await assertFails(deleteDoc(doc(mgrDb, "activityLogs", ref.id)));
  });
});

describe("settings collection", () => {
  it("denies an employee from updating settings", async () => {
    await seedUser("emp16", "employee");
    const empDb = testEnv.authenticatedContext("emp16").firestore();
    await assertFails(
      setDoc(doc(empDb, "settings", "app"), {
        businessName: "test",
        timezone: "Asia/Bahrain",
        updatedAt: serverTimestamp(),
        updatedBy: "emp16",
      })
    );
  });

  it("allows a manager to update settings with the fixed Bahrain timezone", async () => {
    await seedUser("mgr10", "manager");
    const mgrDb = testEnv.authenticatedContext("mgr10").firestore();
    await assertSucceeds(
      setDoc(doc(mgrDb, "settings", "app"), {
        businessName: "نظام إدارة العاملات",
        timezone: "Asia/Bahrain",
        updatedAt: serverTimestamp(),
        updatedBy: "mgr10",
      })
    );
  });

  it("rejects a settings write with a non-Bahrain timezone", async () => {
    await seedUser("mgr11", "manager");
    const mgrDb = testEnv.authenticatedContext("mgr11").firestore();
    await assertFails(
      setDoc(doc(mgrDb, "settings", "app"), {
        businessName: "test",
        timezone: "UTC",
        updatedAt: serverTimestamp(),
        updatedBy: "mgr11",
      })
    );
  });
});
