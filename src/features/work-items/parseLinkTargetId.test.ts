import { describe, expect, it } from "vitest";
import { parseLinkTargetId } from "./parseLinkTargetId";

describe("parseLinkTargetId", () => {
  it.each([
    ["456", 456],
    ["  456  ", 456],
    ["#456", 456],
  ])("accepts %j", (raw, expected) => {
    expect(parseLinkTargetId(raw, 1)).toEqual({ targetId: expected });
  });

  it.each(["12abc", "1e3", "123.9", "0", "-5", "", "#", "# 4", "99999999999999999999"])(
    "rejects %j as an invalid id",
    (raw) => {
      expect(parseLinkTargetId(raw, 1)).toEqual({ error: "Enter a valid work item id." });
    },
  );

  it("rejects linking a work item to itself", () => {
    expect(parseLinkTargetId("42", 42)).toEqual({ error: "Cannot link a work item to itself." });
  });
});
