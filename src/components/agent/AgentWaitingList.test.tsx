import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentWaitingList } from "./AgentWaitingList";

const waiting = vi.hoisted(() => ({ value: [] as unknown[] }));
const navigate = vi.hoisted(() => ({ pr: vi.fn(), wi: vi.fn() }));
const open = vi.hoisted(() => vi.fn());

vi.mock("@/components/agent-notes/useAgentWaiting", () => ({ useAgentWaiting: () => waiting.value }));
vi.mock("@/lib/crossLinks", () => ({ navigateToPullRequest: navigate.pr, navigateToWorkItem: navigate.wi }));
vi.mock("./agentSubject", () => ({ openAgentPanel: open }));

afterEach(cleanup);

describe("AgentWaitingList", () => {
  it("lists conversations waiting elsewhere, skipping the one already shown, and opens them", () => {
    waiting.value = [
      { kind: "pull-request", id: 7, count: 1 },
      { kind: "pull-request", id: 8, count: 2 },
      { kind: "work-item", id: 9, count: 1 },
      { kind: "ask", id: 20240101, count: 1 },
    ];
    render(<AgentWaitingList shownKeys={new Set(["pull-request:7"])} />);
    expect(screen.queryByText(/!7/)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Pull request !8/ }));
    expect(navigate.pr).toHaveBeenCalledWith({ pullRequestId: 8 });
    fireEvent.click(screen.getByRole("button", { name: /Work item #9/ }));
    expect(navigate.wi).toHaveBeenCalledWith({ workItemId: 9 });
    fireEvent.click(screen.getByRole("button", { name: /Request/ }));
    expect(open).toHaveBeenCalledWith({ askId: 20240101, reply: true });
  });

  it("renders nothing when everything waiting is already shown", () => {
    waiting.value = [{ kind: "work-item", id: 9, count: 1 }];
    const { container } = render(<AgentWaitingList shownKeys={new Set(["work-item:9"])} />);
    expect(container.textContent).toBe("");
  });
});
