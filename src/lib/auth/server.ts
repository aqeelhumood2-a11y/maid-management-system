import { cookies } from "next/headers";
import {
  isValidManagerSessionToken,
  MANAGER_SESSION_COOKIE_NAME,
} from "@/lib/server/managerAuth";
import type { Actor } from "@/lib/server/bookingService";

/** True if the request carries a valid, unexpired manager session cookie. */
export async function isManagerSession(): Promise<boolean> {
  const cookieStore = await cookies();
  const token = cookieStore.get(MANAGER_SESSION_COOKIE_NAME)?.value;
  return isValidManagerSessionToken(token);
}

export const EMPLOYEE_ACTOR: Actor = {
  uid: "employee",
  email: "",
  name: "موظف",
  role: "employee",
};

export const MANAGER_ACTOR: Actor = {
  uid: "manager",
  email: "",
  name: "المدير",
  role: "manager",
};

/**
 * The acting identity for a request: the shared manager identity if the
 * manager session cookie is present and valid, otherwise the anonymous
 * employee identity. Every request has SOME actor — there is no
 * "logged out" state for booking-capable routes, since employees were
 * never logged in to begin with.
 */
export async function getActor(): Promise<Actor> {
  return (await isManagerSession()) ? MANAGER_ACTOR : EMPLOYEE_ACTOR;
}
