import { describe, expect, it } from "vitest";
import { initialPrSearchFilters, prSearchInput } from "./prSearchState";

describe("prSearchInput", () => {
  it("sends the local UTC offset with a date window so it covers local days", () => {
    const filters = { ...initialPrSearchFilters(), fromDate: "2026-05-01", toDate: "2026-05-31" };
    const input = prSearchInput("", filters);
    expect(input.fromDate).toBe("2026-05-01");
    expect(input.utcOffsetMinutes).toBe(-new Date().getTimezoneOffset());
  });

  it("leaves the offset out when no date is set", () => {
    expect(prSearchInput("", initialPrSearchFilters()).utcOffsetMinutes).toBeUndefined();
  });
});
