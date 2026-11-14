import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AgentResultMark } from "./AgentResultMark";

const listResultItemIds = vi.hoisted(() => vi.fn());
vi.mock("@/lib/azdoCommands", () => ({ listResultItemIds }));

function renderMarks() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AgentResultMark target="pull-request" itemId={101} />
      <AgentResultMark target="pull-request" itemId={102} />
      <AgentResultMark target="work-item" itemId={101} />
    </QueryClientProvider>,
  );
}

describe("AgentResultMark", () => {
  it("marks only the items whose id has a result file, per target", async () => {
    listResultItemIds.mockImplementation(async (target: string) =>
      target === "pull-request" ? [101] : [],
    );
    renderMarks();

    expect(await screen.findAllByRole("img", { name: "AI review result available" })).toHaveLength(1);
    expect(screen.queryByRole("img", { name: "AI investigation result available" })).toBeNull();
    // One listing per target, shared by every row.
    expect(listResultItemIds).toHaveBeenCalledTimes(2);
  });
});
