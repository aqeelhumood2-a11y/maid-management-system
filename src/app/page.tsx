import { EmployeeShell } from "@/components/layout/EmployeeShell";
import { TodaySchedule } from "@/components/schedule/TodaySchedule";
import { getAdminDb } from "@/lib/firebase/admin";
import { getBusinessName } from "@/lib/server/settings";

/**
 * The root URL — no login, no redirect, this IS the Employee screen.
 * There is no Firebase Authentication anywhere in this app; employees are
 * never asked for any credential.
 */
export default async function RootPage() {
  const businessName = await getBusinessName(getAdminDb());

  return (
    <EmployeeShell businessName={businessName}>
      <TodaySchedule />
    </EmployeeShell>
  );
}
