import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReviewResultFolderSettings } from "./ReviewResultFolderSettings";

vi.mock("@/lib/azdoCommands", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/azdoCommands")>()),
  getAppSettings: vi.fn(async () => {
    throw new Error("database is locked");
  }),
}));

afterEach(cleanup);

describe("settings sections", () => {
  // Every save sends the whole settings object, so saving without the loaded
  // settings would reset every other section to its defaults.
  it("cannot save while the settings failed to load", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ReviewResultFolderSettings />
      </QueryClientProvider>,
    );
    await screen.findByText(/database is locked/);
    expect((screen.getByRole("button", { name: /Save/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});
