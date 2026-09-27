import { describe, expect, it } from "vitest";
import { replyAuthorLabel } from "./NoteThread";

describe("replyAuthorLabel", () => {
  it("labels the user's own replies as You", () => {
    expect(replyAuthorLabel("user")).toEqual({ label: "You", isAgent: false });
  });

  it("labels any other author as an agent by its name", () => {
    expect(replyAuthorLabel("claude")).toEqual({ label: "@Claude", isAgent: true });
    expect(replyAuthorLabel("codex")).toEqual({ label: "@Codex", isAgent: true });
    expect(replyAuthorLabel("agent")).toEqual({ label: "@Agent", isAgent: true });
  });
});
