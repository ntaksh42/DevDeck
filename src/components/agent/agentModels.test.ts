import { expect, it } from "vitest";
import type { AppSettings } from "@/lib/azdoCommands";
import { modelChoices, settingsModel } from "./agentModels";

it("offers the built-in, Settings and extra models once each", () => {
  const settings = {
    claudeModel: "claude-opus-4-1",
    claudeModelChoices: "opus, claude-sonnet-4-5",
    codexModel: null,
    codexModelChoices: "gpt-5.1 gpt-5.1-mini",
  } as AppSettings;
  expect(settingsModel(settings, "claude")).toBe("claude-opus-4-1");
  expect(settingsModel(settings, "codex")).toBe("");
  expect(modelChoices(settings, "claude")).toEqual(["opus", "sonnet", "haiku", "claude-opus-4-1", "claude-sonnet-4-5"]);
  expect(modelChoices(settings, "codex")).toEqual(["gpt-5.1", "gpt-5.1-mini"]);
  expect(modelChoices(undefined, "codex")).toEqual([]);
});
