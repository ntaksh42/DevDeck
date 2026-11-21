import { describe, expect, it } from "vitest";
import { appSettingsSchema } from "@/lib/azdoCommands";
import { applyDemoSettingsUpdate, DEFAULT_DEMO_SETTINGS } from "./settings";

describe("retired approval settings", () => {
  it("ignores an old approval flag while preserving automatic review", () => {
    const legacy = {
      ...DEFAULT_DEMO_SETTINGS,
      autoAgentEnabled: true,
      autoAgentApprovalEnabled: true,
    };
    const decoded = appSettingsSchema.parse(legacy);
    expect(decoded.autoAgentEnabled).toBe(true);
    expect(decoded).not.toHaveProperty("autoAgentApprovalEnabled");

    const saved = applyDemoSettingsUpdate(legacy, { autoAgentEnabled: false });
    expect(saved.autoAgentEnabled).toBe(false);
    expect(saved).not.toHaveProperty("autoAgentApprovalEnabled");
  });
});
