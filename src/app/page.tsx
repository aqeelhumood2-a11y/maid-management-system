import { EmployeeShell } from "@/components/layout/EmployeeShell";
import { TodaySchedule } from "@/components/schedule/TodaySchedule";
import { getAdminDb } from "@/lib/firebase/admin";

/**
 * The root URL — no login, no redirect, this IS the Employee screen.
 * There is no Firebase Authentication anywhere in this app; employees are
 * never asked for any credential.
 */
export default async function RootPage() {
  const settingsDoc = await getAdminDb().collection("settings").doc("app").get();
  const businessName = (settingsDoc.data()?.businessName as string | undefined) || "نظام إدارة العاملات";

  return (
    <EmployeeShell businessName={businessName}>
      <TodaySchedule />
    </EmployeeShell>
  );
}
