// Fails when a source file exceeds the 500-line limit from AGENTS.md.
// Test files that were already over the limit are listed in BASELINE with their
// current size: they may shrink but not grow. Remove an entry once it is split.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const LIMIT = 500;
const EXTENSIONS = /\.(ts|tsx|mts|js|mjs|rs|css)$/;
const BASELINE = {
  "src/App.settings.test.tsx": 590,
  "crates/azdo-client/src/git/tests_commits.rs": 575,
  "src-tauri/src/prs/tests.rs": 574,
  "crates/azdo-client/src/work_items/tests_b.rs": 574,
  "crates/azdo-client/src/pr_review/tests/pr_ops.rs": 538,
  "crates/azdo-client/src/work_items/tests_a.rs": 532,
  "crates/azdo-client/src/client/tests.rs": 530,
  "src/components/DockableWorkspace.test.tsx": 517,
  "crates/azdo-client/src/pipelines/tests.rs": 506,
};

const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
  encoding: "utf8",
})
  .split("\n")
  .filter((file) => EXTENSIONS.test(file));

const problems = [];
for (const file of files) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    continue; // deleted in the working tree
  }
  const lines = text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
  const allowed = BASELINE[file] ?? LIMIT;
  if (lines > allowed) {
    problems.push(`${file}: ${lines} lines (limit ${allowed})`);
  }
}

if (problems.length > 0) {
  console.error("Files over the line limit (split them along module boundaries):");
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
console.log(`check-file-lines: ${files.length} files within limits`);
