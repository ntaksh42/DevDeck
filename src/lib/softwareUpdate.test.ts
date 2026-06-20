import { afterEach, describe, expect, it } from "vitest";
import { checkForUpdate, installUpdateAndRelaunch } from "./softwareUpdate";

afterEach(() => {
  delete (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
});

describe("softwareUpdate (no Tauri runtime)", () => {
  it("checkForUpdate returns null without the desktop runtime", async () => {
    await expect(checkForUpdate()).resolves.toBeNull();
  });

  it("installUpdateAndRelaunch is a no-op without the desktop runtime", async () => {
    await expect(installUpdateAndRelaunch()).resolves.toBeUndefined();
  });
});
