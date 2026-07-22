import { redirect } from "next/navigation";
import { isManagerSession } from "@/lib/auth/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { getBusinessName } from "@/lib/server/settings";
import { ManagerShell } from "@/components/layout/ManagerShell";

/**
 * The only gate in this app: everything under /manager requires the manager
 * password session. A missing/invalid/expired cookie bounces straight back
 * to the Employee screen — there is no separate "login failed" page, per
 * "if the password is incorrect, remain on the Employee screen."
 */
export default async function ManagerLayout({ children }: { children: React.ReactNode }) {
  if (!(await isManagerSession())) redirect("/");

  const businessName = await getBusinessName(getAdminDb());

  return <ManagerShell businessName={businessName}>{children}</ManagerShell>;
}
