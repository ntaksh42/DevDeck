import { describe, expect, it } from "vitest";

import { logLineSeverity } from "./PipelineRunDetailPanel";

describe("logLineSeverity", () => {
  it("classifies the markers Azure Pipelines emits", () => {
    expect(logLineSeverity("##[error]Bash exited with code 1.")).toBe("error");
    expect(logLineSeverity("##[warning]Node 16 is deprecated.")).toBe("warning");
    expect(logLineSeverity("##[ERROR]shouting still counts")).toBe("error");
  });

  it("classifies toolchain diagnostics that lead the line", () => {
    expect(logLineSeverity("npm ERR! code ELIFECYCLE")).toBe("error");
    expect(logLineSeverity("npm WARN deprecated glob@7.2.3")).toBe("warning");
    expect(logLineSeverity("src/main.ts:12:5: error TS2304: Cannot find name")).toBe("error");
    expect(logLineSeverity("src/main.ts:9:1: warning: unused import")).toBe("warning");
  });

  // Regression: a bare /\berror\b/ matched ordinary output, so "Errors/warnings
  // only" showed passing tests and package names and hid nothing useful.
  it("leaves ordinary lines that merely contain the words unclassified", () => {
    expect(logLineSeverity("Downloading package error-handling-utils@1.2.0")).toBeNull();
    expect(logLineSeverity("Restoring cache for errors/")).toBeNull();
    expect(logLineSeverity("  ✓ returns an error message when the input is empty")).toBeNull();
    expect(logLineSeverity("42 passed, 0 failed — no warning raised")).toBeNull();
    expect(logLineSeverity("Checking for warnings in the build output")).toBeNull();
  });

  it("returns null for plain progress output", () => {
    expect(logLineSeverity("Starting: Build solution")).toBeNull();
    expect(logLineSeverity("")).toBeNull();
  });
});
