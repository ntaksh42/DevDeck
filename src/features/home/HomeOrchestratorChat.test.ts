import { describe, expect, it } from "vitest";
import { chatStarters } from "./HomeOrchestratorChat";

describe("chatStarters", () => {
  it("turns brief lines into starters", () => {
    expect(chatStarters(["!798 の CI 失敗が最優先。", " ", "b", "c", "d"])).toEqual([
      "!798 の CI 失敗が最優先 について詳しく",
      "b について詳しく",
      "c について詳しく",
    ]);
  });

  it("falls back to the fixed starters without a brief", () => {
    expect(chatStarters([])).toHaveLength(3);
  });
});
