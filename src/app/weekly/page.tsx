import { EmployeeShell } from "@/components/layout/EmployeeShell";
import { WeeklySchedule } from "@/components/schedule/WeeklySchedule";
import { getAdminDb } from "@/lib/firebase/admin";

export default async function WeeklyPage() {
  const settingsDoc = await getAdminDb().collection("settings").doc("app").get();
  const businessName = (settingsDoc.data()?.businessName as string | undefined) || "نظام إدارة العاملات";

  return (
    <EmployeeShell businessName={businessName}>
      <WeeklySchedule />
    </EmployeeShell>
  );
}
