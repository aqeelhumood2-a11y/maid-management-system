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
    type: "area_added" | "area_edited" | "area_deactivated";
    entityId: string;
    actingUser: ActingUser;
    before: Record<string, unknown> | null;
    after: Record<string, unknown> | null;
  }
) {
  const ref = doc(collection(db, "activityLogs"));
  batch.set(ref, {
    type: entry.type,
    entityType: "area",
    entityId: entry.entityId,
    actingUid: entry.actingUser.uid,
    actingEmail: entry.actingUser.email,
    actingName: entry.actingUser.name,
    before: entry.before,
    after: entry.after,
    createdAt: serverTimestamp(),
  });
}

export async function createArea(db: Firestore, name: string, actingUser: ActingUser): Promise<string> {
  const ref = doc(collection(db, "areas"));
  const batch = writeBatch(db);
  const data = {
    name,
    active: true,
    createdBy: actingUser.uid,
    createdAt: serverTimestamp(),
    updatedBy: actingUser.uid,
    updatedAt: serverTimestamp(),
  };
  batch.set(ref, data);
  logActivityBatch(batch, db, { type: "area_added", entityId: ref.id, actingUser, before: null, after: { ...data, id: ref.id } });
  await batch.commit();
  return ref.id;
}

export async function updateArea(
  db: Firestore,
  areaId: string,
  before: { name: string; active: boolean },
  name: string,
  actingUser: ActingUser
): Promise<void> {
  const ref = doc(db, "areas", areaId);
  const batch = writeBatch(db);
  const after = { name, active: before.active, updatedBy: actingUser.uid, updatedAt: serverTimestamp() };
  batch.update(ref, after);
  logActivityBatch(batch, db, { type: "area_edited", entityId: areaId, actingUser, before, after });
  await batch.commit();
}

export async function setAreaActive(
  db: Firestore,
  areaId: string,
  before: { name: string; active: boolean },
  active: boolean,
  actingUser: ActingUser
): Promise<void> {
  const ref = doc(db, "areas", areaId);
  const batch = writeBatch(db);
  batch.update(ref, { active, updatedBy: actingUser.uid, updatedAt: serverTimestamp() });
  logActivityBatch(batch, db, {
    type: "area_deactivated",
    entityId: areaId,
    actingUser,
    before,
    after: { ...before, active },
  });
  await batch.commit();
}
