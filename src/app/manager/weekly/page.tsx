import { WeeklySchedule } from "@/components/schedule/WeeklySchedule";

/**
 * Weekly Schedule is a manager-only capability — moved under /manager so it
 * gets the same server-side session gate (manager/layout.tsx) as every other
 * manager page, instead of the bespoke top-level route it used to be.
 */
export default function ManagerWeeklyPage() {
  return <WeeklySchedule />;
}
