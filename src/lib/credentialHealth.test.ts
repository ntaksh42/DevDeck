import { describe, expect, it } from "vitest";
import { checkOrganizationCredential } from "./azdoCommands";

// Exercises the check_organization_credential wrapper + Zod schema + demo
// branch via the browser-demo path (no Tauri runtime).
describe("checkOrganizationCredential (demo runtime)", () => {
  it("reports the demo organization as healthy without exposing secrets", async () => {
    const health = await checkOrganizationCredential("contoso");
    expect(health.organizationId).toBe("contoso");
    expect(health.status).toBe("ok");
    expect(health.authProvider).toBeTruthy();
    // The shape carries no secret field.
    expect(Object.keys(health).sort()).toEqual([
      "authProvider",
      "message",
      "organizationId",
      "status",
    ]);
  });
});
