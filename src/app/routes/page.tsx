import { EmployeeShell } from "@/components/layout/EmployeeShell";
import { RouteSchedule } from "@/components/schedule/RouteSchedule";
import { getAdminDb } from "@/lib/firebase/admin";
import { getBusinessName } from "@/lib/server/settings";

/**
 * Route Schedule — one of the exactly two screens an employee session may
 * reach (see requirement #1). Open to everyone, same as Daily Schedule;
 * nothing here exposes payment or pricing data (GET /api/bookings already
 * redacts those for a non-manager session).
 */
export default async function RoutesPage() {
  const businessName = await getBusinessName(getAdminDb());

  return (
    <EmployeeShell businessName={businessName}>
      <RouteSchedule />
    </EmployeeShell>
  );
}
