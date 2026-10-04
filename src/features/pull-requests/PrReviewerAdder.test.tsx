import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const searchPullRequestMentions = vi.fn();
vi.mock("@/lib/azdoCommands", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/azdoCommands")>()),
  searchPullRequestMentions: (...args: unknown[]) => searchPullRequestMentions(...args),
}));

import { PrReviewerAdder } from "./PrReviewerAdder";

const people = [
  { id: "u1", displayName: "Ada Lovelace", uniqueName: "ada@contoso.com" },
  { id: "u2", displayName: "Adam Smith", uniqueName: "adam@contoso.com" },
  { id: "u3", displayName: "Adele Goldberg", uniqueName: null },
];

function renderAdder(overrides: Partial<Parameters<typeof PrReviewerAdder>[0]> = {}) {
  const onAdd = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <PrReviewerAdder
        organizationId="contoso"
        existingReviewerIds={new Set(["u3"])}
        canAddMe
        busy={false}
        onAdd={onAdd}
        {...overrides}
      />
    </QueryClientProvider>,
  );
  return onAdd;
}

beforeEach(() => {
  searchPullRequestMentions.mockReset();
  searchPullRequestMentions.mockResolvedValue(people);
});
afterEach(cleanup);

async function openAndSearch() {
  fireEvent.click(screen.getByText("Add"));
  const input = screen.getByLabelText("Search people to add as a reviewer");
  fireEvent.change(input, { target: { value: "ad" } });
  await screen.findByText("Ada Lovelace");
  return input;
}

describe("PrReviewerAdder", () => {
  it("adds the signed-in user in one click", () => {
    const onAdd = renderAdder();
    fireEvent.click(screen.getByText("Add me"));
    expect(onAdd).toHaveBeenCalledWith({ isRequired: false });
  });

  it("hides Add me when the user already reviews", () => {
    renderAdder({ canAddMe: false });
    expect(screen.queryByText("Add me")).toBeNull();
  });

  it("searches people, skips existing reviewers, and adds the highlighted one with Enter", async () => {
    const onAdd = renderAdder();
    const input = await openAndSearch();

    // Adele is already a reviewer (u3), so only two people are offered.
    expect(screen.queryByText("Adele Goldberg")).toBeNull();
    expect(screen.getAllByRole("option")).toHaveLength(2);

    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.click(screen.getByLabelText("Required"));
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onAdd).toHaveBeenCalledWith({ reviewerId: "u2", isRequired: true });
    // The picker closes and focus returns to the Add button.
    await vi.waitFor(() => expect(document.activeElement).toBe(screen.getByText("Add").closest("button")));
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("closes on Escape without adding", async () => {
    const onAdd = renderAdder();
    const input = await openAndSearch();

    fireEvent.keyDown(input, { key: "Escape" });

    expect(onAdd).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Search people to add as a reviewer")).toBeNull();
  });

  it("does not search for a single character", () => {
    renderAdder();
    fireEvent.click(screen.getByText("Add"));
    fireEvent.change(screen.getByLabelText("Search people to add as a reviewer"), {
      target: { value: "a" },
    });
    expect(searchPullRequestMentions).not.toHaveBeenCalled();
  });
});
