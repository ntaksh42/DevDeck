import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const runAutoQueue = vi.fn();
vi.mock("@/lib/azdoCommands", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/azdoCommands")>()),
  runAutoQueue: (...args: unknown[]) => runAutoQueue(...args),
}));

import type { ReviewPullRequestSummary } from "@/lib/azdoCommands";
import { clearToasts, getSnapshot } from "@/lib/toast";
import { useBulkReviewRequest } from "./useBulkReviewRequest";

function pr(id: number, title: string): ReviewPullRequestSummary {
  return { organizationId: "contoso", pullRequestId: id, title } as ReviewPullRequestSummary;
}

const outerKeys = vi.fn();

function Harness({ prs }: { prs: ReviewPullRequestSummary[] }) {
  const bulk = useBulkReviewRequest(prs);
  return (
    <div onKeyDown={(event) => outerKeys(event.key)}>
      <button type="button" onClick={bulk.request}>
        open
      </button>
      {bulk.dialog}
    </div>
  );
}

function renderHarness(prs: ReviewPullRequestSummary[]) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <Harness prs={prs} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  runAutoQueue.mockReset();
  outerKeys.mockReset();
  runAutoQueue.mockResolvedValue(2);
  clearToasts();
});
afterEach(cleanup);

describe("useBulkReviewRequest", () => {
  it("lists the selected PRs and sends them as pull-request targets after confirming", async () => {
    renderHarness([pr(101, "Rate limiting"), pr(98, "Token signing")]);
    fireEvent.click(screen.getByText("open"));
    expect(screen.getByRole("dialog", { name: "Request a review of 2 PRs?" })).toBeTruthy();
    expect(screen.getByText(/!101 Rate limiting/)).toBeTruthy();
    expect(runAutoQueue).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("Request review"));
    await waitFor(() => expect(runAutoQueue).toHaveBeenCalledTimes(1));
    expect(runAutoQueue.mock.calls[0][0]).toEqual([
      { organizationId: "contoso", target: "pull-request", id: 101 },
      { organizationId: "contoso", target: "pull-request", id: 98 },
    ]);
    expect(runAutoQueue.mock.calls[0][1]).toBeUndefined();
    await waitFor(() => expect(getSnapshot().some((t) => t.message.includes("2 PRs"))).toBe(true));
  });

  it("sends nothing when the dialog is cancelled with Escape", () => {
    renderHarness([pr(101, "Rate limiting")]);
    fireEvent.click(screen.getByText("open"));
    act(() => {
      fireEvent.keyDown(document, { key: "Escape" });
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(runAutoQueue).not.toHaveBeenCalled();
  });

  it("does nothing without a selection", () => {
    renderHarness([]);
    fireEvent.click(screen.getByText("open"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("sends the points to check, opening on the field and confirming with Ctrl+Enter", async () => {
    renderHarness([pr(101, "Rate limiting")]);
    fireEvent.click(screen.getByText("open"));
    const field = screen.getByLabelText(/Points to check/) as HTMLTextAreaElement;
    expect(document.activeElement).toBe(field);
    fireEvent.change(field, { target: { value: "  Is the retry safe?  " } });
    fireEvent.keyDown(field, { key: "Enter", ctrlKey: true });
    await waitFor(() => expect(runAutoQueue).toHaveBeenCalledTimes(1));
    expect(runAutoQueue.mock.calls[0][1]).toBe("Is the retry safe?");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps keys typed in the dialog away from the screen behind it", () => {
    renderHarness([pr(101, "Rate limiting")]);
    fireEvent.click(screen.getByText("open"));
    fireEvent.keyDown(screen.getByLabelText(/Points to check/), { key: "a" });
    fireEvent.keyDown(screen.getByText("Cancel"), { key: "z" });
    expect(outerKeys).not.toHaveBeenCalled();
  });

  it("reports a failure as a toast", async () => {
    runAutoQueue.mockRejectedValue({ message: "boom" });
    renderHarness([pr(101, "Rate limiting")]);
    fireEvent.click(screen.getByText("open"));
    fireEvent.click(screen.getByText("Request review"));
    await waitFor(() =>
      expect(getSnapshot().some((t) => t.message.startsWith("Review request failed"))).toBe(true),
    );
  });
});
