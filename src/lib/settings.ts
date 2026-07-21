import { collection, doc, serverTimestamp, writeBatch, type Firestore } from "firebase/firestore";
import { BAHRAIN_TZ } from "./date";
import type { ActingUser } from "./booking";

export async function updateSettings(
  db: Firestore,
  businessName: string,
  actingUser: ActingUser
): Promise<void> {
  const ref = doc(db, "settings", "app");
  const batch = writeBatch(db);
  batch.set(ref, {
    businessName,
    timezone: BAHRAIN_TZ,
    updatedAt: serverTimestamp(),
    updatedBy: actingUser.uid,
  });
  const logRef = doc(collection(db, "activityLogs"));
  batch.set(logRef, {
    type: "settings_updated",
    entityType: "settings",
    entityId: "app",
    actingUid: actingUser.uid,
    actingEmail: actingUser.email,
    actingName: actingUser.name,
    before: null,
    after: { businessName, timezone: BAHRAIN_TZ },
    createdAt: serverTimestamp(),
  });
  await batch.commit();
}
