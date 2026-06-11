import { describe, expect, it } from "vitest";
import type { MentionCandidate, Organization } from "@/lib/azdoCommands";
import {
  activeMentionAt,
  isSelfIdentity,
  markdownWithHardLineBreaks,
  mentionTokenDeletionStart,
  rankMentionCandidates,
  renderAzureMentionMarkdown,
  sortSelfLast,
  splitMatchSegments,
  splitWorkItemTags,
  workItemStateDotClass,
  workItemTypeColor,
} from "./WorkItemPreviewPanel";

function makeOrg(overrides: {
  authenticatedUserId: string | null;
  authenticatedUserDisplayName: string | null;
  authenticatedUserUniqueName?: string | null;
}): Organization {
  return {
    id: "contoso",
    name: "contoso",
    displayName: "Contoso",
    baseUrl: "https://dev.azure.com/contoso",
    authProvider: "pat",
    credentialKey: "azdodeck:org:contoso:pat",
    authenticatedUserId: overrides.authenticatedUserId,
    authenticatedUserDisplayName: overrides.authenticatedUserDisplayName,
    authenticatedUserUniqueName: overrides.authenticatedUserUniqueName ?? null,
    createdAt: "2026-05-24T00:00:00Z",
    updatedAt: "2026-05-24T00:00:00Z",
  };
}

const self: MentionCandidate = {
  id: "user-guid-1",
  displayName: "Jane Doe",
  uniqueName: "jane.doe@contoso.example",
};

describe("isSelfIdentity", () => {
  it("matches by id", () => {
    const org = makeOrg({ authenticatedUserId: "user-guid-1", authenticatedUserDisplayName: "Other" });
    expect(isSelfIdentity(self, org)).toBe(true);
  });

  it("matches by displayName", () => {
    const org = makeOrg({ authenticatedUserId: "other-guid", authenticatedUserDisplayName: "Jane Doe" });
    expect(isSelfIdentity(self, org)).toBe(true);
  });

  it("matches by uniqueName against stored userId", () => {
    const org = makeOrg({ authenticatedUserId: "jane.doe@contoso.example", authenticatedUserDisplayName: "Other" });
    expect(isSelfIdentity(self, org)).toBe(true);
  });

  it("does not match a different person", () => {
    const org = makeOrg({ authenticatedUserId: "other-guid", authenticatedUserDisplayName: "Bob Smith" });
    expect(isSelfIdentity(self, org)).toBe(false);
  });

  it("returns false when stored id and displayName are null", () => {
    const org = makeOrg({ authenticatedUserId: null, authenticatedUserDisplayName: null });
    expect(isSelfIdentity(self, org)).toBe(false);
  });

  it("returns false when org is undefined", () => {
    expect(isSelfIdentity(self, undefined)).toBe(false);
  });

  it("matches by stored unique name", () => {
    const org = makeOrg({
      authenticatedUserId: "other-guid",
      authenticatedUserDisplayName: "Other",
      authenticatedUserUniqueName: "jane.doe@contoso.example",
    });
    expect(isSelfIdentity(self, org)).toBe(true);
  });

  it("keeps a namesake with a different unique name", () => {
    const org = makeOrg({
      authenticatedUserId: "other-guid",
      authenticatedUserDisplayName: "Jane Doe",
      authenticatedUserUniqueName: "jane.doe@contoso.example",
    });
    const namesake: MentionCandidate = {
      id: "user-guid-2",
      displayName: "Jane Doe",
      uniqueName: "jane.doe.2@contoso.example",
    };
    expect(isSelfIdentity(namesake, org)).toBe(false);
    // Without a unique name the namesake cannot be told apart; keep filtering.
    expect(
      isSelfIdentity({ ...namesake, uniqueName: null }, org),
    ).toBe(true);
  });
});

describe("sortSelfLast", () => {
  it("keeps self in the list but moves it to the end", () => {
    const org = makeOrg({
      authenticatedUserId: "user-guid-1",
      authenticatedUserDisplayName: "Jane Doe",
    });
    const other: MentionCandidate = {
      id: "user-guid-2",
      displayName: "Bob Smith",
      uniqueName: "bob@contoso.example",
    };
    // In a single-member org the list must not become empty.
    expect(sortSelfLast([self], org)).toEqual([self]);
    expect(sortSelfLast([self, other], org)).toEqual([other, self]);
  });
});

describe("rankMentionCandidates", () => {
  it("keeps the recent boost when a remote candidate with the same uniqueName is preferred", () => {
    const recent: MentionCandidate[] = [
      {
        id: "recent-alice-guid",
        displayName: "alice@corp.com",
        uniqueName: "alice@corp.com",
      },
    ];
    const remote: MentionCandidate[] = [
      {
        id: "remote-bob-guid",
        displayName: "Bob",
        uniqueName: "bob@corp.com",
      },
      {
        id: "remote-alice-guid",
        displayName: "Alice Smith",
        uniqueName: "alice@corp.com",
      },
    ];

    const [first] = rankMentionCandidates({
      recent,
      remote,
      query: "",
      priorityNames: [],
    });

    expect(first).toMatchObject({
      id: "remote-alice-guid",
      displayName: "Alice Smith",
      uniqueName: "alice@corp.com",
    });
  });

  it("keeps namesakes with different unique names as separate candidates", () => {
    const remote: MentionCandidate[] = [
      {
        id: "alice-guid-1",
        displayName: "Alice",
        uniqueName: "alice@corp.com",
      },
      {
        id: "alice-guid-2",
        displayName: "Alice",
        uniqueName: "alice.other@corp.com",
      },
    ];

    const ranked = rankMentionCandidates({
      recent: [],
      remote,
      query: "",
      priorityNames: [],
    });

    expect(ranked).toHaveLength(2);
    expect(new Set(ranked.map((candidate) => candidate.id))).toEqual(
      new Set(["alice-guid-1", "alice-guid-2"]),
    );
  });
});

describe("work item preview presentation helpers", () => {
  it("maps known work item types to Azure DevOps colors", () => {
    expect(workItemTypeColor("Bug")).toBe("#CC293D");
    expect(workItemTypeColor("user story")).toBe("#009CCC");
    expect(workItemTypeColor(" Task ")).toBe("#F2CB1D");
    expect(workItemTypeColor("Custom Type")).toBe("#64748B");
  });

  it("maps states to colored dots with a fallback", () => {
    expect(workItemStateDotClass("Done")).toBe("bg-green-500");
    expect(workItemStateDotClass("closed")).toBe("bg-green-500");
    expect(workItemStateDotClass("Resolved")).toBe("bg-amber-500");
    expect(workItemStateDotClass("In Progress")).toBe("bg-blue-500");
    expect(workItemStateDotClass("Removed")).toBe("bg-slate-300");
    expect(workItemStateDotClass("New")).toBe("bg-slate-400");
    expect(workItemStateDotClass("チーム独自状態")).toBe("bg-slate-400");
  });

  it("splits semicolon-separated tags and drops blanks", () => {
    expect(splitWorkItemTags("save; bug; ")).toEqual(["save", "bug"]);
    expect(splitWorkItemTags(null)).toEqual([]);
    expect(splitWorkItemTags("  ")).toEqual([]);
  });

  it("deduplicates repeated tags", () => {
    expect(splitWorkItemTags("save; bug; save")).toEqual(["save", "bug"]);
  });
});

describe("markdownWithHardLineBreaks", () => {
  it("turns single newlines into markdown hard breaks", () => {
    expect(markdownWithHardLineBreaks("@田中 太郎\nこんにちは")).toBe(
      "@田中 太郎  \nこんにちは",
    );
  });

  it("leaves paragraph breaks (blank lines) untouched", () => {
    expect(markdownWithHardLineBreaks("first\n\nsecond")).toBe(
      "first\n\nsecond",
    );
  });

  it("does not add trailing spaces inside fenced code blocks", () => {
    expect(markdownWithHardLineBreaks("before\n```\nlet a = 1;\nlet b = 2;\n```\nafter")).toBe(
      "before  \n```\nlet a = 1;\nlet b = 2;\n```\nafter",
    );
  });

  it("normalizes CRLF and keeps the last line unchanged", () => {
    expect(markdownWithHardLineBreaks("a\r\nb")).toBe("a  \nb");
  });
});

describe("activeMentionAt", () => {
  it("captures a single-word query", () => {
    const text = "hello @ali";
    expect(activeMentionAt(text, text.length)).toEqual({ start: 6, query: "ali" });
  });

  it("allows one internal space for full names", () => {
    const text = "cc @山田 太";
    expect(activeMentionAt(text, text.length)).toEqual({
      start: 3,
      query: "山田 太",
    });
  });

  it("closes on a trailing space after a completed mention", () => {
    const text = "cc @Alice ";
    expect(activeMentionAt(text, text.length)).toBeNull();
  });

  it("closes after a second space", () => {
    const text = "cc @山田 太郎 です";
    expect(activeMentionAt(text, text.length)).toBeNull();
  });
});

const TOM_ID = "11111111-1111-4111-8111-111111111111";
const TOM_SMITH_ID = "22222222-2222-4222-8222-222222222222";
const ALICE_ID = "33333333-3333-4333-8333-333333333333";
const TANAKA_ID = "44444444-4444-4444-8444-444444444444";

describe("renderAzureMentionMarkdown", () => {
  it("processes longer display names first to avoid prefix corruption", () => {
    const mentions = [
      { id: TOM_ID, displayName: "Tom", uniqueName: "tom@corp.com" },
      {
        id: TOM_SMITH_ID,
        displayName: "Tom Smith",
        uniqueName: "tom.smith@corp.com",
      },
    ];
    const result = renderAzureMentionMarkdown("@Tom Smith and @Tom", mentions);
    expect(result).toBe(`@<${TOM_SMITH_ID}> and @<${TOM_ID}>`);
  });

  it("converts mentions followed by punctuation", () => {
    const mentions = [
      { id: ALICE_ID, displayName: "Alice", uniqueName: "alice@corp.com" },
    ];
    expect(renderAzureMentionMarkdown("@Alice, please review", mentions)).toBe(
      `@<${ALICE_ID}>, please review`,
    );
  });

  it("converts mentions followed by CJK text", () => {
    const mentions = [
      { id: TANAKA_ID, displayName: "田中", uniqueName: "tanaka@corp.com" },
    ];
    expect(renderAzureMentionMarkdown("@田中さん確認お願いします", mentions)).toBe(
      `@<${TANAKA_ID}>さん確認お願いします`,
    );
  });

  it("does not convert inside longer Latin words", () => {
    const mentions = [
      { id: TOM_ID, displayName: "Tom", uniqueName: "tom@corp.com" },
    ];
    expect(renderAzureMentionMarkdown("@Tomato is not Tom", mentions)).toBe(
      "@Tomato is not Tom",
    );
  });

  it("keeps the plain text when the id is not a resolvable GUID", () => {
    // Azure DevOps silently deletes @<id> tokens it cannot resolve
    // (descriptors, e-mails); the visible name must survive instead.
    const mentions = [
      { id: "aad.subject-1", displayName: "Alice", uniqueName: "alice@corp.com" },
      { id: "bob@corp.com", displayName: "Bob", uniqueName: "bob@corp.com" },
    ];
    expect(renderAzureMentionMarkdown("@Alice and @Bob hi", mentions)).toBe(
      "@Alice and @Bob hi",
    );
  });
});

describe("mentionTokenDeletionStart", () => {
  const names = ["Alice", "Tom Smith"];

  it("matches a token directly before the cursor", () => {
    const text = "cc @Alice";
    expect(mentionTokenDeletionStart(text, text.length, names)).toBe(3);
  });

  it("includes the trailing space inserted after a mention", () => {
    const text = "cc @Alice ";
    expect(mentionTokenDeletionStart(text, text.length, names)).toBe(3);
  });

  it("handles multi-word display names", () => {
    const text = "@Tom Smith ";
    expect(mentionTokenDeletionStart(text, text.length, names)).toBe(0);
  });

  it("prefers the longest matching name", () => {
    const text = "@Tom Smith";
    expect(mentionTokenDeletionStart(text, text.length, ["Smith", "Tom Smith"])).toBe(0);
  });

  it("returns null when the cursor is inside the token", () => {
    const text = "cc @Alice tail";
    expect(mentionTokenDeletionStart(text, 7, names)).toBeNull();
  });

  it("returns null for plain text", () => {
    const text = "no mentions here";
    expect(mentionTokenDeletionStart(text, text.length, names)).toBeNull();
    expect(mentionTokenDeletionStart(text, 0, names)).toBeNull();
  });
});

describe("splitMatchSegments", () => {
  it("marks the first case-insensitive match", () => {
    expect(splitMatchSegments("Alice Johnson", "john")).toEqual([
      { text: "Alice ", match: false },
      { text: "John", match: true },
      { text: "son", match: false },
    ]);
  });

  it("returns a single segment when the query is empty or does not match", () => {
    expect(splitMatchSegments("Alice", "")).toEqual([{ text: "Alice", match: false }]);
    expect(splitMatchSegments("Alice", "  ")).toEqual([{ text: "Alice", match: false }]);
    expect(splitMatchSegments("Alice", "bob")).toEqual([{ text: "Alice", match: false }]);
  });

  it("handles matches at the start and covering the whole text", () => {
    expect(splitMatchSegments("alice@corp.com", "alice")).toEqual([
      { text: "alice", match: true },
      { text: "@corp.com", match: false },
    ]);
    expect(splitMatchSegments("Alice", "alice")).toEqual([{ text: "Alice", match: true }]);
  });
});
