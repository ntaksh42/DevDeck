import type { CommitRefsResult } from "@/lib/azdoCommands";

// A couple of demo commits show containing branches/tags so the preview
// panel's "Contained in" section has something to render; the rest fall back
// to the default (just `main`) so the empty/typical case stays exercised too.
const DEMO_COMMIT_REFS: Record<string, CommitRefsResult> = {
  abcdef1234567890abcdef1234567890abcdef12: {
    refs: [
      { kind: "branch", name: "main" },
      { kind: "branch", name: "release/2026.05" },
      { kind: "tag", name: "v2026.05.0" },
    ],
    truncated: false,
  },
  cafe5678901234567890abcdef1234567890cafe: {
    refs: [{ kind: "branch", name: "main" }],
    truncated: false,
  },
};

export function demoCommitRefs(commitId?: string): CommitRefsResult {
  if (!commitId) return { refs: [], truncated: false };
  return DEMO_COMMIT_REFS[commitId] ?? { refs: [{ kind: "branch", name: "main" }], truncated: false };
}
