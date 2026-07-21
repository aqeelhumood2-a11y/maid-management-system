"use client";

import { onAuthStateChanged, signOut } from "firebase/auth";
import { useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { getFirebaseAuth } from "@/lib/firebase/client";
import type { ActingUser } from "@/lib/booking";
import type { Role } from "@/lib/types";

export interface AuthUser {
  uid: string;
  email: string;
  name: string;
  role: Role;
}

interface AuthContextValue {
  user: AuthUser;
  actingUser: ActingUser;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({
  initialUser,
  children,
}: {
  initialUser: AuthUser;
  children: ReactNode;
}) {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const auth = getFirebaseAuth();
    const unsubscribe = onAuthStateChanged(auth, (fbUser) => {
      if (!fbUser && ready) {
        router.replace("/login");
        return;
      }
      setReady(true);
    });
    return unsubscribe;
  }, [router, ready]);

  async function logout() {
    await signOut(getFirebaseAuth());
    await fetch("/api/session", { method: "DELETE" });
    window.location.href = "/login";
  }

  const actingUser: ActingUser = {
    uid: initialUser.uid,
    email: initialUser.email,
    name: initialUser.name,
  };

  return (
    <AuthContext.Provider value={{ user: initialUser, actingUser, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
