import { describe, expect, it } from "vitest";
import { logLineSeverity } from "./pipelineLogSeverity";

describe("logLineSeverity", () => {
  it("flags explicit pipeline commands", () => {
    expect(logLineSeverity("2026-06-13T09:00:05.1Z ##[error]Process completed with exit code 1.")).toBe("error");
    expect(logLineSeverity("##[warning]Layer already exists")).toBe("warning");
  });

  it("flags tool output that names a severity with a colon", () => {
    expect(logLineSeverity("Error: unauthorized")).toBe("error");
    expect(logLineSeverity("Program.cs(3,1): error CS1002: ; expected")).toBe("error");
    expect(logLineSeverity("npm ERR! code E404")).toBe("error");
    expect(logLineSeverity("warning CS0168: variable declared but never used")).toBe("warning");
  });

  it("ignores prose that merely contains the word", () => {
    expect(logLineSeverity("0 errors in lint")).toBeNull();
    expect(logLineSeverity("no error found")).toBeNull();
    expect(logLineSeverity("Starting error handling setup")).toBeNull();
    expect(logLineSeverity("Build succeeded with 0 warnings")).toBeNull();
  });
});
