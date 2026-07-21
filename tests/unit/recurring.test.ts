import { describe, expect, it } from "vitest";
import { availableDaysOfWeek } from "@/lib/recurring";

describe("availableDaysOfWeek", () => {
  it("excludes Friday (value 5) since it is a fixed holiday", () => {
    const values = availableDaysOfWeek().map((d) => d.value);
    expect(values).not.toContain(5);
    expect(values).toHaveLength(6);
  });
});
