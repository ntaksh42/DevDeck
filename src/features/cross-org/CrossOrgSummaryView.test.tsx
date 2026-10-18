import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CrossOrgSummaryView } from "./CrossOrgSummaryView";

const switchConnection = vi.fn();
vi.mock("@/lib/azdoCommands", async (original) => ({
  ...await original<typeof import("@/lib/azdoCommands")>(),
  listOrganizations: async () => [{ id: "a", name: "First" }, { id: "b", name: "Second" }],
  listMyReviewPullRequests: async () => [],
  listMyWorkItems: async () => [],
  setActiveOrganization: (id: string) => switchConnection(id),
}));

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onOpenView = vi.fn();
  const wrapper = ({ children }: { children: ReactNode }) =>
    <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  render(<CrossOrgSummaryView onOpenView={onOpenView} />, { wrapper });
  return { client, onOpenView };
}

beforeEach(() => { switchConnection.mockReset(); });
afterEach(cleanup);

describe("CrossOrgSummaryView connection switching", () => {
  it("keeps the summary open and shows the error if switching fails", async () => {
    switchConnection.mockRejectedValue({ message: "Connection unavailable" });
    const { onOpenView } = mount();
    fireEvent.click((await screen.findAllByRole("button", { name: "0 to review" }))[1]);
    await waitFor(() => expect(switchConnection).toHaveBeenCalledWith("b"));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Connection unavailable"));
    expect(onOpenView).not.toHaveBeenCalled();
    await waitFor(() => expect((screen.getAllByRole("button")[0] as HTMLButtonElement).disabled).toBe(false));
    switchConnection.mockResolvedValue(undefined);
    fireEvent.click(screen.getAllByRole("button", { name: "0 to review" })[1]);
    await waitFor(() => expect(onOpenView).toHaveBeenCalledWith("myReviews"));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("blocks competing switches and opens the requested view after refresh", async () => {
    let complete!: () => void;
    switchConnection.mockImplementation(() => new Promise<void>((resolve) => { complete = resolve; }));
    const { client, onOpenView } = mount();
    const refresh = vi.spyOn(client, "invalidateQueries");
    const buttons = await screen.findAllByRole("button");
    fireEvent.click(buttons[3]);
    await waitFor(() => expect(buttons.every((button) => (button as HTMLButtonElement).disabled)).toBe(true));
    fireEvent.click(buttons[0]);
    expect(switchConnection).toHaveBeenCalledTimes(1);
    expect(onOpenView).not.toHaveBeenCalled();
    complete();
    await waitFor(() => expect(onOpenView).toHaveBeenCalledWith("myWorkItems"));
    expect(switchConnection).toHaveBeenCalledWith("b");
    expect(refresh).toHaveBeenCalled();
  });
});
