import { describe, expect, it } from "vitest";
import { pollIntervalForRangeMode, type RangeMode } from "@/app/manager/reports/page";

/**
 * The "All" report range spans the entire booking history — polling it on
 * the normal 20s cadence would re-read all bookings ever made every 20
 * seconds, exactly the kind of unbounded repeated read that exhausted the
 * Firestore quota. pollIntervalForRangeMode is what usePolledFetch's
 * interval is derived from; every bounded mode must keep the normal
 * default (undefined => usePolledFetch's own default), only "all" must
 * switch to an effectively-never-repoll interval.
 */
describe("pollIntervalForRangeMode", () => {
  const boundedModes: RangeMode[] = ["day", "range", "week", "month"];

  it.each(boundedModes)("keeps the default polling interval for bounded range mode %s", (mode) => {
    expect(pollIntervalForRangeMode(mode)).toBeUndefined();
  });

  it("returns an effectively-never-repoll interval for 'all'", () => {
    const interval = pollIntervalForRangeMode("all");
    expect(interval).toBeDefined();
    // Must be dramatically larger than the normal 20s default — proves this
    // mode does not repeat the full-history read on the usual cadence.
    expect(interval!).toBeGreaterThan(20000 * 100);
  });
});
