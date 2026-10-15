import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SoftwareUpdateSettings } from "./SoftwareUpdateSettings";

vi.mock("@/lib/runtime", () => ({ isTauriRuntime: () => true }));
vi.mock("@/lib/softwareUpdate", () => ({
  // The updater plugin rejects with a plain string.
  checkForUpdate: vi.fn(async () => {
    throw "Could not fetch a valid release JSON from the remote";
  }),
  installUpdateAndRelaunch: vi.fn(),
}));
vi.mock("./useExperimentalFlags", () => ({ useExperimentalFlag: () => false }));

afterEach(cleanup);

describe("SoftwareUpdateSettings", () => {
  it("shows the updater's own reason when a check fails", async () => {
    render(<SoftwareUpdateSettings />);
    fireEvent.click(screen.getByRole("button", { name: /Check for updates/ }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Could not fetch a valid release JSON from the remote",
    );
  });
});
