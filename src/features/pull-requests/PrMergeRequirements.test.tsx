import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { PrMergeRequirements, isBlockingRequirement } from "./PrMergeRequirements";

const listPolicies = vi.hoisted(() => vi.fn());

vi.mock("@/lib/azdoCommands", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/azdoCommands")>()),
  listPullRequestPolicies: listPolicies,
}));

const pr = { organizationId: "o", projectId: "p", repositoryId: "r", pullRequestId: 1 };

function renderRow() {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <PrMergeRequirements pr={pr} />
    </QueryClientProvider>,
  );
}

describe("PrMergeRequirements", () => {
  it("lists the policies and counts the required ones that have not passed", async () => {
    listPolicies.mockResolvedValue([
      { name: "Minimum number of reviewers", status: "rejected", isBlocking: true, detail: "2 approvers required" },
      { name: "Build", status: "approved", isBlocking: true, detail: null },
      { name: "Comments", status: "rejected", isBlocking: false, detail: null },
    ]);
    renderRow();
    expect(await screen.findByText("Blocked (1)")).toBeTruthy();
    expect(screen.getByText(/Minimum number of reviewers/)).toBeTruthy();
    expect(screen.getByText("Failed (optional)")).toBeTruthy();
  });

  it("shows nothing when no policy applies", async () => {
    listPolicies.mockResolvedValue([]);
    const { container } = renderRow();
    await vi.waitFor(() => expect(listPolicies).toHaveBeenCalled());
    expect(container.textContent).toBe("");
  });

  it("keeps a failed lookup inside the row", async () => {
    listPolicies.mockRejectedValue(new Error("403"));
    renderRow();
    expect(await screen.findByText("Merge requirements unavailable.")).toBeTruthy();
  });

  it("treats only unpassed required policies as blocking", () => {
    expect(isBlockingRequirement({ name: "a", status: "running", isBlocking: true, detail: null })).toBe(true);
    expect(isBlockingRequirement({ name: "a", status: "approved", isBlocking: true, detail: null })).toBe(false);
    expect(isBlockingRequirement({ name: "a", status: "rejected", isBlocking: false, detail: null })).toBe(false);
  });
});
