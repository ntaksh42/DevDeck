import { describe, expect, it } from "vitest";

import { resolveQueueBranch, toSourceBranchRef } from "./useQueueRunForm";

const BRANCHES = [
  { name: "main", isDefault: true },
  { name: "develop", isDefault: false },
];

describe("resolveQueueBranch", () => {
  it("applies the default branch when nothing is chosen yet", () => {
    expect(resolveQueueBranch("", BRANCHES)).toBe("main");
  });

  // Regression: the effect reran on every refetch and overwrote the branch
  // unconditionally, so a run picked as "develop" silently queued on "main".
  it("keeps a chosen branch when the list is refetched unchanged", () => {
    expect(resolveQueueBranch("develop", BRANCHES)).toBe("develop");
  });

  it("falls back to the default when the chosen branch is gone", () => {
    expect(resolveQueueBranch("deleted-branch", BRANCHES)).toBe("main");
  });

  it("keeps the current value when no branch is marked default", () => {
    const noDefault = [{ name: "topic", isDefault: false }];
    expect(resolveQueueBranch("typed-by-hand", noDefault)).toBe("typed-by-hand");
  });

  it("keeps the current value for an empty branch list", () => {
    expect(resolveQueueBranch("develop", [])).toBe("develop");
  });
});

describe("toSourceBranchRef", () => {
  it("expands a short branch name to a full ref", () => {
    expect(toSourceBranchRef("main")).toBe("refs/heads/main");
  });

  it("leaves an already-qualified ref alone", () => {
    expect(toSourceBranchRef("refs/heads/main")).toBe("refs/heads/main");
    expect(toSourceBranchRef("refs/pull/12/merge")).toBe("refs/pull/12/merge");
  });
});
