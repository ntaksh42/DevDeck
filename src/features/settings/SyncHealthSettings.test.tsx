import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const triggerSync = vi.fn();

vi.mock("@/lib/azdoCommands", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/azdoCommands")>()),
  listSyncStates: () => Promise.resolve([]),
  triggerSync: (...args: unknown[]) => triggerSync(...args),
}));

import { SyncHealthSettings } from "./SyncHealthSettings";

afterEach(cleanup);

describe("SyncHealthSettings", () => {
  it("rebuilds the PR cache from the keyboard-reachable button", async () => {
    triggerSync.mockReset().mockResolvedValue(undefined);
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <SyncHealthSettings organizations={[]} />
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Rebuild PR cache" }));

    await waitFor(() =>
      expect(triggerSync).toHaveBeenCalledWith({ scope: "myReviews", rebuildPullRequests: true }),
    );
  });
});
