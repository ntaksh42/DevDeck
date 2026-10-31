import { beforeEach, expect, it } from "vitest";
import { demoPaletteSearch } from "./palette";

beforeEach(() => window.localStorage.clear());

it("searches title substrings and exact IDs", () => {
  const result = demoPaletteSearch({ organizationId: "contoso", query: "42" });
  expect(result.pullRequests[0].pullRequestId).toBe(42);
  expect(demoPaletteSearch({ organizationId: "contoso", query: "boarding" }).workItems.some((wi) => wi.id === 123)).toBe(true);
});

it("does not match metadata or another organization", () => {
  expect(demoPaletteSearch({ organizationId: "contoso", query: "Alice Johnson" }).workItems).toEqual([]);
  expect(demoPaletteSearch({ organizationId: "elsewhere", query: "42" }).pullRequests).toEqual([]);
  const result = demoPaletteSearch({ organizationId: "contoso", query: "OpenTelemetry" });
  expect(result.pullRequests.every((pr) => pr.status === "active")).toBe(true);
  expect(result.pullRequests.some((pr) => pr.pullRequestId === 99)).toBe(false);
});

it("treats numeric input as an exact ID and respects the requested kind", () => {
  expect(demoPaletteSearch({ query: "12" }).workItems).toEqual([]);
  expect(demoPaletteSearch({ query: "123", kind: "pullRequests" }).workItems).toEqual([]);
  expect(demoPaletteSearch({ query: "42", kind: "workItems" }).pullRequests).toEqual([]);
});
