import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PrReviewerAdder } from "./PrReviewerAdder";

afterEach(cleanup);

const pr = { organizationId: "org", projectId: "p", repositoryId: "r", pullRequestId: 1 };

function renderAdder(existing: string[] = []) {
  const onAdd = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <PrReviewerAdder
        organizationId="org"
        pr={pr}
        existingReviewerIds={new Set(existing)}
        canAddMe
        busy={false}
        onAdd={onAdd}
      />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Add" }));
  return onAdd;
}

describe("PrReviewerAdder suggestions", () => {
  it("offers people from recent commits with the reason, and adds one with Enter", async () => {
    const onAdd = renderAdder();
    expect(await screen.findByText("Carol Wang")).toBeTruthy();
    expect(screen.getByText("6 recent commits across 3 changed files")).toBeTruthy();
    expect(screen.getByText(/Suggested from recent commits/)).toBeTruthy();

    const input = screen.getByRole("combobox");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onAdd).toHaveBeenCalledWith({ reviewerId: "demo-frank", isRequired: false });
  });

  it("does not suggest someone who already reviews the PR", async () => {
    renderAdder(["demo-carol"]);
    expect(await screen.findByText("Frank Lee")).toBeTruthy();
    expect(screen.queryByText("Carol Wang")).toBeNull();
  });
});
