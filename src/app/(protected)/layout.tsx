import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/auth/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { AuthProvider } from "@/context/AuthContext";
import { AppShell } from "@/components/layout/AppShell";

export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession();
  if (!session) redirect("/login");

  const settingsDoc = await getAdminDb().collection("settings").doc("app").get();
  const businessName = (settingsDoc.data()?.businessName as string | undefined) || "نظام إدارة العاملات";

  return (
    <AuthProvider initialUser={session}>
      <AppShell businessName={businessName}>{children}</AppShell>
    </AuthProvider>
  );
}
