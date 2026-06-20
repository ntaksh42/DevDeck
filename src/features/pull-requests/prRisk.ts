import type { PrChangedFile } from "@/lib/azdoCommands";

// A pull request changing this many files (or more) is flagged as a large
// review. Azure DevOps does not return per-file line counts on the changes
// API, so file count is the cheap, always-available size signal.
export const LARGE_REVIEW_FILE_COUNT = 20;

// Paths that look like automated tests. Used to flag PRs that change code but
// touch no tests.
const TEST_PATH_PATTERN =
  /(\.(test|spec)\.)|(^|\/)(tests?|__tests__|specs?)(\/|$)|(_test\.)|(test_[^/]*\.py$)/i;

// Security-sensitive areas worth a closer look before approving. A built-in
// default set; not user-configurable yet.
const SENSITIVE_PATH_PATTERN =
  /(^|\/)(auth|authentication|authorization|security|secrets?)(\/|$)|secret|credential|password|\.env(\.|$)|(^|\/)\.github\/workflows\//i;

function normalize(path: string): string {
  return path.replace(/^\/+/, "");
}

function isTestPath(path: string): boolean {
  return TEST_PATH_PATTERN.test(normalize(path));
}

function isSensitivePath(path: string): boolean {
  return SENSITIVE_PATH_PATTERN.test(normalize(path));
}

export type ChangeSummary = {
  total: number;
  added: number;
  modified: number;
  deleted: number;
  renamed: number;
};

// Composition of the change set by Azure DevOps change type. Mirrors the
// token-aware classification used by the Files tab badges.
export function summarizeChanges(files: PrChangedFile[]): ChangeSummary {
  const summary: ChangeSummary = { total: files.length, added: 0, modified: 0, deleted: 0, renamed: 0 };
  for (const file of files) {
    const tokens = file.changeType.toLowerCase().split(",").map((token) => token.trim());
    if (tokens.includes("rename")) summary.renamed += 1;
    else if (tokens.includes("delete")) summary.deleted += 1;
    else if (tokens.includes("add") || tokens.includes("undelete")) summary.added += 1;
    else summary.modified += 1;
  }
  return summary;
}

export type RiskFlags = {
  large: boolean;
  // Code changed but no test file was touched.
  noTests: boolean;
  sensitive: boolean;
  // Sensitive paths in the change set, for the badge tooltip.
  sensitiveFiles: string[];
};

export function computeRiskFlags(files: PrChangedFile[]): RiskFlags {
  const nonDeleted = files.filter(
    (file) => !file.changeType.toLowerCase().split(",").map((t) => t.trim()).includes("delete"),
  );
  const testFiles = files.filter((file) => isTestPath(file.path));
  const codeFiles = files.filter((file) => !isTestPath(file.path));
  const sensitiveFiles = files.filter((file) => isSensitivePath(file.path)).map((file) => file.path);

  return {
    large: files.length >= LARGE_REVIEW_FILE_COUNT,
    // Only meaningful when there is code to test: a PR that touches code files
    // but adds/edits no test files.
    noTests: codeFiles.length > 0 && testFiles.length === 0 && nonDeleted.length > 0,
    sensitive: sensitiveFiles.length > 0,
    sensitiveFiles,
  };
}

export function hasAnyRisk(flags: RiskFlags): boolean {
  return flags.large || flags.noTests || flags.sensitive;
}
