import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it } from "vitest";
import { StartupSettings } from "./StartupSettings";

afterEach(cleanup);

describe("StartupSettings", () => {
  it("disables the options in the browser preview and says why", async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <StartupSettings />
      </QueryClientProvider>,
    );
    expect(screen.getByText("These options are only available in the desktop app.")).toBeTruthy();
    await waitFor(() =>
      expect(
        (screen.getByLabelText(/Start DevDeck when I sign in/) as HTMLInputElement).disabled,
      ).toBe(true),
    );
    expect(
      (screen.getByLabelText(/Keep running in the tray/) as HTMLInputElement).disabled,
    ).toBe(true);
  });
});
