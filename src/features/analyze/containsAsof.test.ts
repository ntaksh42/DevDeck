import { describe, expect, it } from "vitest";
import { containsAsof } from "./AnalyzeGroupDialog";

describe("containsAsof", () => {
  it("finds an ASOF clause", () => {
    expect(containsAsof("SELECT [System.Id] FROM WorkItems ASOF '2026-01-01'")).toBe(true);
  });

  it("ignores string literals and field names", () => {
    expect(containsAsof("SELECT [System.Id] FROM WorkItems WHERE [System.Title] CONTAINS 'asof'")).toBe(false);
    expect(containsAsof("SELECT [System.Id] FROM WorkItems WHERE [Custom.AsOf] = 1")).toBe(false);
    expect(containsAsof("SELECT [System.Id] FROM WorkItems WHERE Custom.AsOf = 1")).toBe(false);
    expect(containsAsof("SELECT [System.Id] FROM WorkItems WHERE [System.Title] = 'it''s asof'")).toBe(false);
  });
});
