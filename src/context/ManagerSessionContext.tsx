"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

interface ManagerSessionValue {
  isManager: boolean;
  setIsManager: (value: boolean) => void;
}

const ManagerSessionContext = createContext<ManagerSessionValue | null>(null);

/**
 * Tracks, client-side, whether the manager password session is currently
 * active — purely for UI decisions (which nav links/buttons to show). This
 * is NOT a security boundary: every manager-only action is re-checked
 * server-side against the real signed cookie (see src/lib/auth/server.ts).
 * Seeded from the real cookie check the root layout already does server-side,
 * then kept in sync locally by the login/logout actions themselves — no
 * extra request needed.
 */
export function ManagerSessionProvider({
  initialIsManager,
  children,
}: {
  initialIsManager: boolean;
  children: ReactNode;
}) {
  const [isManager, setIsManager] = useState(initialIsManager);
  return (
    <ManagerSessionContext.Provider value={{ isManager, setIsManager }}>
      {children}
    </ManagerSessionContext.Provider>
  );
}

export function useManagerSession(): ManagerSessionValue {
  const ctx = useContext(ManagerSessionContext);
  if (!ctx) throw new Error("useManagerSession must be used within ManagerSessionProvider");
  return ctx;
}
