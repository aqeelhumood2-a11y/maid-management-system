import {
  collection,
  doc,
  serverTimestamp,
  writeBatch,
  type Firestore,
  type WriteBatch,
} from "firebase/firestore";
import type { ActingUser } from "./booking";

function logActivityBatch(
  batch: WriteBatch,
  db: Firestore,
  entry: {
    type: "worker_added" | "worker_edited" | "worker_activated" | "worker_deactivated";
    entityId: string;
    actingUser: ActingUser;
    before: Record<string, unknown> | null;
    after: Record<string, unknown> | null;
  }
) {
  const ref = doc(collection(db, "activityLogs"));
  batch.set(ref, {
    type: entry.type,
    entityType: "worker",
    entityId: entry.entityId,
    actingUid: entry.actingUser.uid,
    actingEmail: entry.actingUser.email,
    actingName: entry.actingUser.name,
    before: entry.before,
    after: entry.after,
    createdAt: serverTimestamp(),
  });
}

export async function createWorker(
  db: Firestore,
  input: { name: string; phone: string },
  actingUser: ActingUser
): Promise<string> {
  const ref = doc(collection(db, "workers"));
  const batch = writeBatch(db);
  const data = {
    name: input.name,
    phone: input.phone,
    active: true,
    createdBy: actingUser.uid,
    createdAt: serverTimestamp(),
    updatedBy: actingUser.uid,
    updatedAt: serverTimestamp(),
  };
  batch.set(ref, data);
  logActivityBatch(batch, db, {
    type: "worker_added",
    entityId: ref.id,
    actingUser,
    before: null,
    after: { ...data, id: ref.id },
  });
  await batch.commit();
  return ref.id;
}

export async function updateWorker(
  db: Firestore,
  workerId: string,
  before: { name: string; phone: string; active: boolean },
  patch: { name: string; phone: string },
  actingUser: ActingUser
): Promise<void> {
  const ref = doc(db, "workers", workerId);
  const batch = writeBatch(db);
  const after = {
    name: patch.name,
    phone: patch.phone,
    active: before.active,
    updatedBy: actingUser.uid,
    updatedAt: serverTimestamp(),
  };
  batch.update(ref, after);
  logActivityBatch(batch, db, {
    type: "worker_edited",
    entityId: workerId,
    actingUser,
    before,
    after,
  });
  await batch.commit();
}

export async function setWorkerActive(
  db: Firestore,
  workerId: string,
  before: { name: string; phone: string; active: boolean },
  active: boolean,
  actingUser: ActingUser
): Promise<void> {
  const ref = doc(db, "workers", workerId);
  const batch = writeBatch(db);
  const after = { ...before, active, updatedBy: actingUser.uid, updatedAt: serverTimestamp() };
  batch.update(ref, { active, updatedBy: actingUser.uid, updatedAt: serverTimestamp() });
  logActivityBatch(batch, db, {
    type: active ? "worker_activated" : "worker_deactivated",
    entityId: workerId,
    actingUser,
    before,
    after,
  });
  await batch.commit();
}
