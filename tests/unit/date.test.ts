import { describe, expect, it } from "vitest";
import {
  addDaysToDateStr,
  dayOfWeek,
  isFriday,
  weekDates,
  weekStart,
} from "@/lib/date";

describe("date helpers", () => {
  it("identifies Friday correctly", () => {
    // 2026-07-24 is a Friday
    expect(isFriday("2026-07-24")).toBe(true);
    expect(isFriday("2026-07-23")).toBe(false);
    expect(isFriday("2026-07-25")).toBe(false);
  });

  it("computes day of week independent of timezone (UTC-anchored calendar date)", () => {
    expect(dayOfWeek("2026-07-24")).toBe(5); // Friday
    expect(dayOfWeek("2026-07-18")).toBe(6); // Saturday
    expect(dayOfWeek("2026-07-19")).toBe(0); // Sunday
  });

  it("adds days across month boundaries", () => {
    expect(addDaysToDateStr("2026-07-30", 3)).toBe("2026-08-02");
    expect(addDaysToDateStr("2026-08-02", -3)).toBe("2026-07-30");
  });

  it("computes week start as Saturday", () => {
    // Wednesday 2026-07-22 -> week starts Saturday 2026-07-18
    expect(weekStart("2026-07-22")).toBe("2026-07-18");
    // Saturday itself is the start of its own week
    expect(weekStart("2026-07-18")).toBe("2026-07-18");
  });

  it("returns 7 consecutive dates for a week, ending on Friday", () => {
    const dates = weekDates("2026-07-18");
    expect(dates).toHaveLength(7);
    expect(dates[0]).toBe("2026-07-18");
    expect(dates[6]).toBe("2026-07-24");
    expect(isFriday(dates[6])).toBe(true);
  });
});
