import { describe, expect, it } from "vitest";
import type { MentionCandidate } from "@/lib/azdoCommands";
import { rankMentionCandidates } from "./WorkItemPreviewPanel";

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
