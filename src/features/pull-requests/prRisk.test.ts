import { describe, expect, it } from "vitest";
import type { PrChangedFile } from "@/lib/azdoCommands";
import {
  computeRiskFlags,
  summarizeChanges,
  LARGE_REVIEW_FILE_COUNT,
} from "./prRisk";

function file(path: string, changeType = "edit"): PrChangedFile {
  return { path, changeType, originalPath: null };
}

describe("summarizeChanges", () => {
  it("counts files by change type token", () => {
    const summary = summarizeChanges([
      file("a.ts", "edit"),
      file("b.ts", "add"),
      file("c.ts", "delete"),
      file("d.ts", "rename, edit"),
    ]);
    expect(summary).toEqual({ total: 4, added: 1, modified: 1, deleted: 1, renamed: 1 });
  });
});

describe("computeRiskFlags", () => {
  it("flags large change sets by file count", () => {
    const many = Array.from({ length: LARGE_REVIEW_FILE_COUNT }, (_, i) => file(`src/m${i}.ts`));
    expect(computeRiskFlags(many).large).toBe(true);
    expect(computeRiskFlags(many.slice(0, LARGE_REVIEW_FILE_COUNT - 1)).large).toBe(false);
  });

  it("flags code changes with no test files touched", () => {
    expect(computeRiskFlags([file("src/app.ts")]).noTests).toBe(true);
  });

  it("does not flag noTests when a test file is included", () => {
    const flags = computeRiskFlags([file("src/app.ts"), file("src/app.test.ts")]);
    expect(flags.noTests).toBe(false);
  });

  it("recognizes several test path shapes", () => {
    expect(computeRiskFlags([file("src/app.ts"), file("__tests__/app.ts")]).noTests).toBe(false);
    expect(computeRiskFlags([file("src/app.ts"), file("api/foo_test.go")]).noTests).toBe(false);
    expect(computeRiskFlags([file("src/app.ts"), file("tests/test_app.py")]).noTests).toBe(false);
  });

  it("does not flag noTests for a delete-only change set", () => {
    expect(computeRiskFlags([file("src/old.ts", "delete")]).noTests).toBe(false);
  });

  it("flags security-sensitive paths and lists them", () => {
    const flags = computeRiskFlags([file("src/auth/session.ts"), file("README.md")]);
    expect(flags.sensitive).toBe(true);
    expect(flags.sensitiveFiles).toEqual(["src/auth/session.ts"]);
  });

  it("treats .github/workflows and secrets as sensitive", () => {
    expect(computeRiskFlags([file(".github/workflows/ci.yml")]).sensitive).toBe(true);
    expect(computeRiskFlags([file("config/database.secret.yml")]).sensitive).toBe(true);
  });

  it("leaves a small, tested, ordinary change set with no risk flags", () => {
    const flags = computeRiskFlags([file("src/app.ts"), file("src/app.test.ts")]);
    expect(flags).toEqual({ large: false, noTests: false, sensitive: false, sensitiveFiles: [] });
  });
});
