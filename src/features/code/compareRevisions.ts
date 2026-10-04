import type { RepoFileVersion, RevisionType } from "@/lib/azdoCommands";

// One side of a comparison: a branch, tag or commit.
export type Revision = { type: RevisionType; value: string };

// A 7-40 hex-digit ref is treated as a commit SHA; anything else as a tag.
export function refVersion(ref: string): RepoFileVersion {
  return /^[0-9a-f]{7,40}$/i.test(ref)
    ? { versionType: "commit", version: ref }
    : { versionType: "tag", version: ref };
}

// A typed commit SHA / tag overrides the branch picker. Null when neither is set.
export function revisionFor(typedRef: string, branch: string): Revision | null {
  const typed = typedRef.trim();
  if (typed) {
    const version = refVersion(typed);
    return { type: version.versionType, value: version.version };
  }
  return branch ? { type: "branch", value: branch } : null;
}

// How to fetch a file at this revision: branch tips need no explicit version.
export function fileVersion(revision: Revision): RepoFileVersion | undefined {
  return revision.type === "branch"
    ? undefined
    : { versionType: revision.type, version: revision.value };
}

// Whether `path` is `folder` itself or lies beneath it (`/` matches everything).
export function isUnderFolder(path: string, folder: string): boolean {
  const base = folder.replace(/\/+$/, "");
  return base === "" || path === base || path.startsWith(`${base}/`);
}
