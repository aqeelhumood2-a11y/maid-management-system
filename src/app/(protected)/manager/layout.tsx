import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/auth/server";
import { ManagerNav } from "@/components/layout/ManagerNav";

export default async function ManagerLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession();
  if (!session || session.role !== "manager") redirect("/today");

  return (
    <div className="flex flex-col gap-5">
      <ManagerNav />
      <div>{children}</div>
    </div>
  );
}
