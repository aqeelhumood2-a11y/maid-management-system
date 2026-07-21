import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { readFileSync } from "node:fs";
import { afterAll, afterEach, beforeAll, describe, it } from "vitest";
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

describe("slots collection — client writes are always denied", () => {
  // Double-booking / Friday-authorization enforcement lives entirely in the
  // trusted server layer now (src/lib/server/bookingService.ts, called only
  // from src/app/api/bookings and src/app/api/recurring). Firestore rules'
  // job here is simply to make sure no client — employee or manager — can
  // write to this collection directly, which is what actually closes the
  // "an employee could bypass the UI and write to Firestore" bypass.
  it("denies an employee creating a slot directly, even with well-formed data", async () => {
    await seedUser("emp5", "employee");
    const empDb = testEnv.authenticatedContext("emp5").firestore();
    await assertFails(
      setDoc(doc(empDb, "slots", "w1_2026-07-22_morning"), {
        bookingId: "b1",
        workerId: "w1",
        date: "2026-07-22",
        shift: "morning",
        createdAt: serverTimestamp(),
      })
    );
  });

  it("denies a manager creating a slot directly too — everyone goes through the server", async () => {
    await seedUser("mgr-slot", "manager");
    const mgrDb = testEnv.authenticatedContext("mgr-slot").firestore();
    await assertFails(
      setDoc(doc(mgrDb, "slots", "w1_2026-07-24_morning"), {
        bookingId: "b1",
        workerId: "w1",
        date: "2026-07-24",
        shift: "morning",
        createdAt: serverTimestamp(),
      })
    );
  });

  it("denies deleting a slot directly (releasing one is also a server-side operation)", async () => {
    await seedUser("emp7", "employee");
    const empDb = testEnv.authenticatedContext("emp7").firestore();
    const slotRef = doc(empDb, "slots", "w1_2026-07-24_afternoon");
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "slots", "w1_2026-07-24_afternoon"), {
        bookingId: "b1",
        workerId: "w1",
        date: "2026-07-24",
        shift: "afternoon",
        createdAt: serverTimestamp(),
      });
    });
    await assertFails(deleteDoc(slotRef));
  });

  it("still allows reads, so the real-time schedule grids keep working", async () => {
    await seedUser("emp5b", "employee");
    const empDb = testEnv.authenticatedContext("emp5b").firestore();
    await assertSucceeds(getDocs(collection(empDb, "slots")));
  });
});

describe("bookings collection — client writes are always denied", () => {
  it("denies an employee creating a booking directly, even a well-formed weekday one", async () => {
    await seedUser("emp8", "employee");
    const empDb = testEnv.authenticatedContext("emp8").firestore();
    await assertFails(
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

  it("denies a manager creating a booking directly too, including one dated on a Friday", async () => {
    // This is the exact bypass the fix closes: previously an authenticated
    // client (any role) could write straight to `bookings` and the only
    // thing stopping a Friday booking was the UI never offering the form.
    await seedUser("mgr4", "manager");
    const mgrDb = testEnv.authenticatedContext("mgr4").firestore();
    await assertFails(
      addDoc(collection(mgrDb, "bookings"), {
        date: "2026-07-24", // Friday
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
        source: "manager_future",
        recurringSeriesId: null,
        status: "active",
        cancelledAt: null,
        cancelledBy: null,
        cancelledReason: null,
        cancelScope: null,
        createdBy: "mgr4",
        createdAt: serverTimestamp(),
        updatedBy: "mgr4",
        updatedAt: serverTimestamp(),
      })
    );
  });

  it("denies editing an existing booking directly (e.g. trying to move it onto a Friday date)", async () => {
    await seedUser("emp10", "employee");
    const empDb = testEnv.authenticatedContext("emp10").firestore();
    let bookingId = "";
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const ref = await addDoc(collection(ctx.firestore(), "bookings"), {
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
        createdBy: "emp10",
        createdAt: serverTimestamp(),
        updatedBy: "emp10",
        updatedAt: serverTimestamp(),
      });
      bookingId = ref.id;
    });
    await assertFails(updateDoc(doc(empDb, "bookings", bookingId), { date: "2026-07-24" }));
  });

  it("never allows deleting a booking (only cancellation via the server, by status)", async () => {
    let bookingId = "";
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const ref = await addDoc(collection(ctx.firestore(), "bookings"), {
        date: "2026-07-22",
        shift: "morning",
        workerId: "w1",
        areaId: "a1",
        hours: 4,
        amount: 10,
        status: "active",
        createdBy: "seed",
        createdAt: serverTimestamp(),
        updatedBy: "seed",
        updatedAt: serverTimestamp(),
      });
      bookingId = ref.id;
    });
    await seedUser("mgr5", "manager");
    const mgrDb = testEnv.authenticatedContext("mgr5").firestore();
    await assertFails(deleteDoc(doc(mgrDb, "bookings", bookingId)));
  });

  it("still allows reads, so real-time schedules/reports keep working", async () => {
    await seedUser("emp8b", "employee");
    const empDb = testEnv.authenticatedContext("emp8b").firestore();
    await assertSucceeds(getDocs(collection(empDb, "bookings")));
  });
});

describe("recurringSchedules & recurringExceptions — client writes are always denied", () => {
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

  it("denies a manager from creating a recurring schedule directly too — server-only, same as bookings", async () => {
    await seedUser("mgr7", "manager");
    const mgrDb = testEnv.authenticatedContext("mgr7").firestore();
    await assertFails(
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

  it("denies creating a recurringException directly", async () => {
    await seedUser("mgr7b", "manager");
    const mgrDb = testEnv.authenticatedContext("mgr7b").firestore();
    await assertFails(
      setDoc(doc(mgrDb, "recurringExceptions", "r1_2026-08-05"), {
        recurringId: "r1",
        date: "2026-08-05",
        type: "cancelled",
        reason: null,
        createdBy: "mgr7b",
        createdAt: serverTimestamp(),
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
