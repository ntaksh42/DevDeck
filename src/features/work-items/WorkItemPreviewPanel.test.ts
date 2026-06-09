import { describe, expect, it } from "vitest";
import type { MentionCandidate, Organization } from "@/lib/azdoCommands";
import {
  isSelfIdentity,
  rankMentionCandidates,
  renderAzureMentionMarkdown,
} from "./WorkItemPreviewPanel";

function makeOrg(overrides: {
  authenticatedUserId: string | null;
  authenticatedUserDisplayName: string | null;
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
});

describe("renderAzureMentionMarkdown", () => {
  it("processes longer display names first to avoid prefix corruption", () => {
    const mentions = [
      { id: "tom-id", displayName: "Tom", uniqueName: "tom@corp.com" },
      {
        id: "tom-smith-id",
        displayName: "Tom Smith",
        uniqueName: "tom.smith@corp.com",
      },
    ];
    const result = renderAzureMentionMarkdown("@Tom Smith and @Tom", mentions);
    expect(result).toBe("@<tom-smith-id> and @<tom-id>");
  });
});
