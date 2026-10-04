import { describe, expect, it } from "vitest";
import { hasDistinctCommitter } from "./commitIdentity";

const author = { authorName: "Alice", authorEmail: "alice@x.com" };

describe("hasDistinctCommitter", () => {
  it("is false when there is no committer information", () => {
    expect(hasDistinctCommitter({ ...author })).toBe(false);
    expect(hasDistinctCommitter({ ...author, committerName: null, committerEmail: null })).toBe(false);
  });

  it("compares emails case-insensitively when both are present", () => {
    expect(
      hasDistinctCommitter({ ...author, committerName: "A. Smith", committerEmail: "ALICE@x.com" }),
    ).toBe(false);
    expect(
      hasDistinctCommitter({ ...author, committerName: "Alice", committerEmail: "bob@x.com" }),
    ).toBe(true);
  });

  it("falls back to names when an email is missing", () => {
    expect(
      hasDistinctCommitter({ authorName: "Alice", authorEmail: null, committerName: "alice" }),
    ).toBe(false);
    expect(
      hasDistinctCommitter({ authorName: "Alice", authorEmail: null, committerName: "Bob" }),
    ).toBe(true);
  });
});
