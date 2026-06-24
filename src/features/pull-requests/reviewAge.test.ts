import { describe, expect, it } from "vitest";
import { reviewAgeDays } from "./MyReviewsGrid";

const NOW = new Date("2026-06-20T12:00:00Z").getTime();

describe("reviewAgeDays", () => {
  it("returns whole days since creation", () => {
    expect(reviewAgeDays("2026-06-15T12:00:00Z", NOW)).toBe(5);
    expect(reviewAgeDays("2026-06-20T00:00:00Z", NOW)).toBe(0);
  });

  it("clamps negative ages (clock skew) to zero", () => {
    expect(reviewAgeDays("2026-06-25T00:00:00Z", NOW)).toBe(0);
  });

  it("returns null for an unparseable date", () => {
    expect(reviewAgeDays("not-a-date", NOW)).toBeNull();
  });
});
