import { describe, expect, it } from "vitest";
import {
  compareExtraColumnValues,
  compareExtraColumnValuesDirected,
  extraColumnForKey,
  extraColumnKey,
  extraColumnLabel,
  extraColumnValueTitle,
  formatExtraColumnValue,
  normalizeExtraColumns,
} from "./extraColumns";

describe("normalizeExtraColumns", () => {
  it("accepts the legacy string[] shape without a field type", () => {
    expect(normalizeExtraColumns(["Custom.ReleaseTrain"])).toEqual([
      { referenceName: "Custom.ReleaseTrain" },
    ]);
  });

  it("keeps the field type from the typed shape", () => {
    expect(
      normalizeExtraColumns([{ referenceName: "Custom.Due", fieldType: "dateTime" }]),
    ).toEqual([{ referenceName: "Custom.Due", fieldType: "dateTime" }]);
  });

  it("drops invalid reference names and case-insensitive duplicates", () => {
    expect(
      normalizeExtraColumns([
        "not-a-field",
        "Custom.A",
        { referenceName: "custom.a", fieldType: "string" },
        { referenceName: "Custom.B" },
      ]),
    ).toEqual([{ referenceName: "Custom.A" }, { referenceName: "Custom.B" }]);
  });

  it("caps the column count at 20", () => {
    const many = Array.from({ length: 30 }, (_, i) => `Custom.Field${i}`);
    expect(normalizeExtraColumns(many)).toHaveLength(20);
  });

  it("returns an empty list for non-array input", () => {
    expect(normalizeExtraColumns(undefined)).toEqual([]);
    expect(normalizeExtraColumns({ referenceName: "Custom.A" })).toEqual([]);
  });
});

describe("formatExtraColumnValue", () => {
  it("renders booleans as Yes/No", () => {
    expect(formatExtraColumnValue("true", "boolean")).toBe("Yes");
    expect(formatExtraColumnValue("False", "boolean")).toBe("No");
  });

  it("renders dates relatively and keeps unparsable text as-is", () => {
    expect(formatExtraColumnValue(new Date().toISOString(), "dateTime")).toBe("just now");
    expect(formatExtraColumnValue("not a date", "dateTime")).toBe("not a date");
  });

  it("strips markup from HTML fields", () => {
    expect(formatExtraColumnValue("<p>Hello <b>world</b></p>", "html")).toBe("Hello world");
  });

  it("treats null, empty, and whitespace-only values as absent", () => {
    expect(formatExtraColumnValue(null, "string")).toBeNull();
    expect(formatExtraColumnValue("   ", "string")).toBeNull();
    expect(formatExtraColumnValue("<p>  </p>", "html")).toBeNull();
  });

  it("passes untyped values through as trimmed text", () => {
    expect(formatExtraColumnValue("  Ready  ", undefined)).toBe("Ready");
  });
});

describe("extraColumnValueTitle", () => {
  it("shows the absolute timestamp for dates", () => {
    const iso = "2026-01-15T09:30:00.000Z";
    expect(extraColumnValueTitle(iso, "dateTime")).toBe(new Date(iso).toLocaleString());
  });

  it("falls back to the raw value for other types", () => {
    expect(extraColumnValueTitle("Ready", "string")).toBe("Ready");
    expect(extraColumnValueTitle(null, "string")).toBeUndefined();
  });
});

describe("compareExtraColumnValues", () => {
  it("compares numbers numerically, not lexicographically", () => {
    expect(compareExtraColumnValues("9", "10", "integer")).toBeLessThan(0);
    expect(compareExtraColumnValues("9", "10", "string")).toBeGreaterThan(0);
  });

  it("compares dates chronologically", () => {
    expect(
      compareExtraColumnValues("2026-01-02T00:00:00Z", "2026-01-10T00:00:00Z", "dateTime"),
    ).toBeLessThan(0);
  });

  it("orders false before true", () => {
    expect(compareExtraColumnValues("false", "true", "boolean")).toBeLessThan(0);
  });

  it("sorts empty values after populated ones in ascending order", () => {
    expect(compareExtraColumnValues(null, "a", "string")).toBeGreaterThan(0);
    expect(compareExtraColumnValues("a", null, "string")).toBeLessThan(0);
    expect(compareExtraColumnValues(null, "", "string")).toBe(0);
  });

  it("falls back to text comparison when a typed value is unparsable", () => {
    expect(compareExtraColumnValues("abc", "bcd", "integer")).toBeLessThan(0);
  });
});

describe("compareExtraColumnValuesDirected", () => {
  it("reverses populated values for descending order", () => {
    expect(compareExtraColumnValuesDirected("2", "10", "integer", "asc")).toBeLessThan(0);
    expect(compareExtraColumnValuesDirected("2", "10", "integer", "desc")).toBeGreaterThan(0);
  });

  it("keeps empty values last in both directions", () => {
    for (const direction of ["asc", "desc"] as const) {
      expect(compareExtraColumnValuesDirected(null, "a", "string", direction)).toBeGreaterThan(0);
      expect(compareExtraColumnValuesDirected("a", null, "string", direction)).toBeLessThan(0);
    }
  });

  it("treats two empty values as equal", () => {
    expect(compareExtraColumnValuesDirected(null, "  ", "string", "desc")).toBe(0);
  });
});

describe("extraColumnKey / extraColumnForKey", () => {
  it("round-trips a column through its sort key", () => {
    const columns = [{ referenceName: "Custom.Due", fieldType: "dateTime" }];
    const key = extraColumnKey("Custom.Due");
    expect(extraColumnForKey(key, columns)).toEqual(columns[0]);
  });

  it("matches the key case-insensitively", () => {
    const columns = [{ referenceName: "Custom.Due" }];
    expect(extraColumnForKey(extraColumnKey("CUSTOM.DUE"), columns)).toEqual(columns[0]);
  });

  it("returns null for standard columns and unknown fields", () => {
    expect(extraColumnForKey("changedDate", [{ referenceName: "Custom.Due" }])).toBeNull();
    expect(extraColumnForKey(extraColumnKey("Custom.Gone"), [])).toBeNull();
  });
});

describe("extraColumnLabel", () => {
  it("uses the last dotted segment", () => {
    expect(extraColumnLabel("Microsoft.VSTS.Common.Priority")).toBe("Priority");
    expect(extraColumnLabel("Custom.ReleaseTrain")).toBe("ReleaseTrain");
  });
});
