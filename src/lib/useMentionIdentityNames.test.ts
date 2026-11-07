import { describe, expect, it } from "vitest";
import { extractMentionIds } from "./useMentionIdentityNames";

const ID = "9CE68702-0694-6EF4-B9FA-0F3143502233";

describe("extractMentionIds", () => {
  it("collects lower-cased unique guids from raw and escaped mentions", () => {
    expect(extractMentionIds([`hi @<${ID}>`, `&lt;p&gt;@&lt;${ID.toLowerCase()}&gt;`, null])).toEqual([
      ID.toLowerCase(),
    ]);
  });

  it("ignores mention tokens that are not guids", () => {
    expect(extractMentionIds(["@<user-reviewer> and @Name"])).toEqual([]);
  });
});
