import { describe, expect, it } from "vitest";
import { filterSuggestions } from "./FilterAutocomplete";

describe("filterSuggestions", () => {
  const pool = ["azdo-dashboard", "api-gateway", "Alice Johnson", "android-app", "api-gateway"];

  it("returns nothing for an empty query", () => {
    expect(filterSuggestions(pool, "  ")).toEqual([]);
  });

  it("matches case-insensitively and de-duplicates", () => {
    expect(filterSuggestions(pool, "api")).toEqual(["api-gateway"]);
  });

  it("matches anywhere in the value", () => {
    expect(filterSuggestions(pool, "app")).toEqual(["android-app"]);
  });

  it("excludes an exact (case-insensitive) match but keeps longer values that contain it", () => {
    expect(filterSuggestions(["Bug", "Bugfix"], "bug")).toEqual(["Bugfix"]);
  });

  it("caps the number of suggestions at 8", () => {
    const many = Array.from({ length: 20 }, (_, i) => `item-${i}`);
    expect(filterSuggestions(many, "item").length).toBe(8);
  });
});
