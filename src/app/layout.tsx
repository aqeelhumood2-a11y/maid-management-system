import type { Metadata, Viewport } from "next";
import { Cairo } from "next/font/google";
import { isManagerSession } from "@/lib/auth/server";
import { ManagerSessionProvider } from "@/context/ManagerSessionContext";
import "./globals.css";

const cairo = Cairo({
  subsets: ["arabic", "latin"],
  variable: "--font-cairo",
});

export const metadata: Metadata = {
  title: "نظام إدارة العاملات",
  description: "نظام إدارة حجوزات العاملات وجدولة المواعيد",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const isManager = await isManagerSession();

  return (
    <html lang="ar" dir="rtl" className={`${cairo.variable} h-full`}>
      <body className="flex min-h-full flex-col bg-slate-50 font-sans text-slate-900 antialiased">
        <ManagerSessionProvider initialIsManager={isManager}>{children}</ManagerSessionProvider>
      </body>
    </html>
  );
}
