import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { closeAgentPanel, resetAgentPanelState } from "./agentPanelStore";
import { openAgentPanel, publishAgentSubject, toggleAgentPanel } from "./agentSubject";
import { AgentPanelHost } from "./AgentPanelHost";
import {
  asks,
  createAgentNote,
  deleteAgentNote,
  note,
  openPanel,
  pr,
  renderHost,
  replyAgentNote,
  resetFixtures,
  runAgent,
  setAgentNoteStatus,
  state,
} from "./agentPanelTestFixtures";

vi.mock("@/lib/azdoCommands", async (importOriginal) => {
  const m = await import("./agentPanelTestMocks");
  return {
    ...(await importOriginal<typeof import("@/lib/azdoCommands")>()),
    getAppSettings: vi.fn(async () => ({ readOnlyValidationModeEnabled: false })),
    listAgentAsks: vi.fn(async () => m.state.asks),
    deleteAgentNote: (input: unknown) => m.deleteAgentNote(input),
    listAgentNotes: vi.fn(async () => m.state.prNotes),
    createAgentNote: (input: unknown) => m.createAgentNote(input),
    replyAgentNote: (input: unknown) => m.replyAgentNote(input),
    runAgent: (input: unknown) => m.runAgent(input),
    setAgentNoteStatus: (input: unknown) => m.setAgentNoteStatus(input),
  };
});
vi.mock("./contextDocument", () => ({ buildContextDocument: vi.fn(async () => "# material") }));

afterEach(resetFixtures);

/** The conversation rows of the list, in order. */
const rows = (panel: HTMLElement) => Array.from(panel.querySelectorAll<HTMLButtonElement>("button[data-agent-conversation]"));

describe("Agent panel", () => {
  it("opens focused on the input; Esc folds it to the list, then closes and returns focus", async () => {
    renderHost();
    const grid = screen.getByRole("button", { name: "grid" });
    grid.focus();
    const panel = await openPanel();
    await waitFor(() => expect(document.activeElement?.tagName).toBe("TEXTAREA"));
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    await waitFor(() => expect(document.activeElement).toBe(rows(panel)[0]));
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("complementary", { name: "Agent" })).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(grid));
    expect(panel.isConnected).toBe(false);
  });

  it("lists conversations with waiting ones first, opens one with Enter and goes back with Esc", async () => {
    renderHost();
    const panel = await openPanel();
    const [waiting, done] = rows(panel);
    expect(waiting.textContent).toContain("Why did run 412 fail?");
    expect(waiting.textContent).toContain("Needs you");
    expect(done.textContent).toContain("Done");
    // The list shows no messages; opening a conversation shows them, and only its own.
    expect(within(panel).queryByText("Which culture should the test pin?")).toBeNull();

    waiting.focus();
    fireEvent.keyDown(waiting, { key: "ArrowDown" });
    expect(document.activeElement).toBe(done);
    fireEvent.keyDown(done, { key: "ArrowUp" });
    fireEvent.keyDown(waiting, { key: "Enter" });
    const chat = await within(panel).findByLabelText("Conversation: Why did run 412 fail?");
    await waitFor(() => expect(document.activeElement).toBe(chat));
    expect(within(chat).getByText("Which culture should the test pin?")).toBeTruthy();
    expect(within(panel).queryByText("Summarize last week")).toBeNull();
    // The user's own message sits on the right, the agent's on the left.
    expect(chat.querySelector('[data-agent-message="user"]')?.textContent).toContain("Why did run 412 fail?");
    expect(chat.querySelector('[data-agent-message="agent"]')?.textContent).toContain("claude");

    fireEvent.keyDown(chat, { key: "Escape" });
    await waitFor(() => expect(document.activeElement).toBe(rows(panel)[0]));
    expect(screen.getByRole("complementary", { name: "Agent" })).toBeTruthy();
  });

  it("sends a request without a subject as a new ask and starts the agent", async () => {
    renderHost();
    const panel = await openPanel();
    fireEvent.change(within(panel).getByPlaceholderText(/Ask the agent/), { target: { value: "Summarize today" } });
    fireEvent.click(within(panel).getByRole("button", { name: "Ask" }));
    await waitFor(() => expect(runAgent).toHaveBeenCalled());
    expect(createAgentNote).toHaveBeenCalledWith(
      expect.objectContaining({ target: "ask", body: "Summarize today", kind: null, contextDocument: null }),
    );
  });

  it("sends one request to the agent picked with the keyboard, then returns to the default", async () => {
    renderHost();
    const panel = await openPanel();
    const claude = within(panel).getByRole("radio", { name: "Claude" });
    expect(claude.getAttribute("aria-checked")).toBe("true");
    claude.focus();
    fireEvent.keyDown(claude, { key: "ArrowRight" });
    const codex = within(panel).getByRole("radio", { name: "Codex" });
    expect(document.activeElement).toBe(codex);
    expect(codex.getAttribute("aria-checked")).toBe("true");
    // Picking another agent starts from its Settings model (none here: the CLI's own).
    const model = within(panel).getByRole("combobox", { name: "Model" }) as HTMLSelectElement;
    expect(model.value).toBe("");
    expect(within(model).queryByRole("option", { name: "opus" })).toBeNull();
    // Esc goes back to the input.
    fireEvent.keyDown(codex, { key: "Escape" });
    await waitFor(() => expect(document.activeElement?.tagName).toBe("TEXTAREA"));
    fireEvent.change(within(panel).getByPlaceholderText(/Ask the agent/), { target: { value: "Summarize today" } });
    fireEvent.click(within(panel).getByRole("button", { name: "Ask" }));
    await waitFor(() => expect(runAgent).toHaveBeenCalledWith(expect.objectContaining({ agent: "codex", model: "" })));
    await waitFor(() => expect(claude.getAttribute("aria-checked")).toBe("true"));
  });

  it("sends one request with the model picked for it", async () => {
    renderHost();
    const panel = await openPanel();
    const model = within(panel).getByRole("combobox", { name: "Model" });
    fireEvent.change(model, { target: { value: "opus" } });
    fireEvent.change(within(panel).getByPlaceholderText(/Ask the agent/), { target: { value: "Summarize today" } });
    fireEvent.click(within(panel).getByRole("button", { name: "Ask" }));
    await waitFor(() => expect(runAgent).toHaveBeenCalledWith(expect.objectContaining({ agent: "claude", model: "opus" })));
    await waitFor(() => expect((model as HTMLSelectElement).value).toBe(""));
  });

  it("follows the selection, attaches its material, and keeps a pinned subject", async () => {
    renderHost();
    act(() => publishAgentSubject(pr));
    const panel = await openPanel("Check the retry logic");
    // The selection is attached as a chip above the input and named in its placeholder.
    expect(within(panel).getByPlaceholderText("Ask about !68 Add ToDo API… (M)")).toBeTruthy();
    expect(within(panel).getByRole("button", { name: "Attached: !68 Add ToDo API" })).toBeTruthy();
    // Only the PR's own conversations: requests about other things stay out.
    expect(within(panel).queryByText("Why did run 412 fail?")).toBeNull();

    fireEvent.click(within(panel).getByRole("button", { name: "Pin the subject" }));
    act(() => publishAgentSubject(null));
    expect(within(panel).getByText("!68 Add ToDo API")).toBeTruthy();

    fireEvent.change(within(panel).getByPlaceholderText(/Ask about/), { target: { value: "Review this" } });
    fireEvent.click(within(panel).getByRole("button", { name: "Ask" }));
    await waitFor(() => expect(runAgent).toHaveBeenCalledWith(expect.objectContaining({ repositoryName: "TestRepos" })));
    expect(createAgentNote).toHaveBeenCalledWith(
      expect.objectContaining({ target: "pull-request", itemId: 68, contextDocument: "# material" }),
    );

    fireEvent.click(within(panel).getByRole("button", { name: "Remove the subject" }));
    expect(within(panel).getByText(/nothing in this view/)).toBeTruthy();
    // The input is folded after sending; its button carries the placeholder.
    expect(within(panel).getByRole("button", { name: /Ask the agent/ })).toBeTruthy();
  });

  it("replies with r: opens the conversation and uses the one input at the bottom", async () => {
    renderHost();
    const panel = await openPanel();
    const [waiting] = rows(panel);
    waiting.focus();
    fireEvent.keyDown(waiting, { key: "r" });
    const input = await within(panel).findByPlaceholderText(/^Reply…/);
    await waitFor(() => expect(document.activeElement).toBe(input));
    // One input only: the new-request one is gone while a conversation is open.
    expect(within(panel).queryByPlaceholderText(/Ask the agent/)).toBeNull();
    expect(within(panel).queryByRole("button", { name: /Ask the agent/ })).toBeNull();
    // Typing in it does not trigger the conversation's keys.
    fireEvent.keyDown(input, { key: "x" });
    expect(setAgentNoteStatus).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: "Pin en-US" } });
    fireEvent.click(within(panel).getByRole("button", { name: "Reply" }));
    await waitFor(() => expect(replyAgentNote).toHaveBeenCalledWith(
      expect.objectContaining({ target: "ask", itemId: 20261011090000, noteId: "a.md", body: "Pin en-US" }),
    ));
    expect(runAgent).toHaveBeenCalled();
  });

  it("Esc in the empty reply input returns to the conversation, the next Esc to the list", async () => {
    renderHost();
    const panel = await openPanel();
    const [waiting] = rows(panel);
    waiting.focus();
    fireEvent.keyDown(waiting, { key: "r" });
    const input = await within(panel).findByPlaceholderText(/^Reply…/);
    await waitFor(() => expect(document.activeElement).toBe(input));
    fireEvent.keyDown(input, { key: "Escape" });
    const chat = within(panel).getByLabelText("Conversation: Why did run 412 fail?");
    await waitFor(() => expect(document.activeElement).toBe(chat));
    fireEvent.keyDown(chat, { key: "Escape" });
    await waitFor(() => expect(document.activeElement).toBe(rows(panel)[0]));
  });

  it("Esc on a row closes a panel opened from <body> and lands on the view's grid", async () => {
    resetAgentPanelState();
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <div data-primary-grid="true">
          <div role="row" aria-selected="true" tabIndex={0} data-testid="row" />
        </div>
        <AgentPanelHost />
      </QueryClientProvider>,
    );
    act(() => toggleAgentPanel());
    const panel = await screen.findByRole("complementary", { name: "Agent" });
    await within(panel).findAllByText("Why did run 412 fail?");
    const [waiting] = rows(panel);
    waiting.focus();
    fireEvent.keyDown(waiting, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("complementary", { name: "Agent" })).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId("row")));
  });

  it("Delete on a row moves focus to the next conversation, then to the input when none are left", async () => {
    renderHost();
    const panel = await openPanel();
    const [waiting, done] = rows(panel);
    waiting.focus();
    fireEvent.keyDown(waiting, { key: "Delete" });
    await waitFor(() => expect(deleteAgentNote).toHaveBeenCalledWith(expect.objectContaining({ noteId: "a.md" })));
    await waitFor(() => expect(rows(panel)).toHaveLength(1));
    await waitFor(() => expect(document.activeElement).toBe(done));

    // The last open conversation, deleted from inside it: back to the list, focus on the input.
    state.asks = [{ ...asks[0], notes: [note("c.md", "Only one")] }];
    cleanup();
    const second = renderHost();
    const only = (await second.findByText("Only one")).closest("button")!;
    only.focus();
    fireEvent.keyDown(only, { key: "Enter" });
    const chat = await second.findByLabelText("Conversation: Only one");
    fireEvent.keyDown(chat, { key: "Delete" });
    await waitFor(() => expect(second.queryByText("Only one")).toBeNull());
    await waitFor(() => expect(document.activeElement?.closest("[data-agent-composer]")).not.toBeNull());
  });
});

describe("Agent panel keys", () => {
  it("pins with p and runs the agent now with Shift+Enter", async () => {
    renderHost();
    act(() => publishAgentSubject(pr));
    const panel = await openPanel("Check the retry logic");
    const [first] = rows(panel);
    first.focus();
    fireEvent.keyDown(first, { key: "p" });
    act(() => publishAgentSubject(null));
    expect(within(panel).getByRole("button", { name: "Unpin the subject" })).toBeTruthy();

    fireEvent.keyDown(first, { key: "Enter", shiftKey: true });
    await waitFor(() => expect(runAgent).toHaveBeenCalled());
    expect(createAgentNote).not.toHaveBeenCalled();
  });

  it("m in a conversation goes back to the list and a new request", async () => {
    renderHost();
    const panel = await openPanel();
    const [first] = rows(panel);
    first.focus();
    fireEvent.keyDown(first, { key: "Enter" });
    const chat = await within(panel).findByLabelText("Conversation: Why did run 412 fail?");
    fireEvent.keyDown(chat, { key: "m" });
    const input = await within(panel).findByPlaceholderText(/Ask the agent/);
    await waitFor(() => expect(document.activeElement).toBe(input));
  });
});

describe("Agent panel proposed comments", () => {
  it("gathers unposted comments in the tray above the input and points at them in the conversation", async () => {
    state.prNotes = [
      note("pr.md", "Review this", {
        replies: [
          { author: "claude", createdAt: "2026-10-11T09:05:00+09:00", body: "Two issues." },
          { author: "claude", createdAt: "2026-10-11T09:06:00+09:00", body: "Guard a zero limit.", kind: "post", postedAt: null, postedRef: null },
        ],
      }),
    ];
    renderHost();
    act(() => publishAgentSubject(pr));
    const panel = await openPanel("Review this");
    expect(rows(panel)[0].textContent).toContain("1 to post");
    fireEvent.click(rows(panel)[0]);
    const chat = await within(panel).findByLabelText("Conversation: Review this");
    expect(within(chat).getByText(/proposed a comment — waiting below/)).toBeTruthy();
    expect(within(chat).queryByText("Guard a zero limit.")).toBeNull();
    const tray = panel.querySelector<HTMLElement>("[data-agent-proposal-tray]")!;
    expect(within(tray).getByText("Guard a zero limit.")).toBeTruthy();
    expect(within(tray).getByRole("button", { name: /Proposed comments to post: 1/ })).toBeTruthy();
  });
});

describe("Agent panel reply request", () => {
  it("does not reopen in reply mode after an earlier reply request", async () => {
    renderHost();
    act(() => openAgentPanel({ subject: null, reply: true }));
    const panel = await screen.findByRole("complementary", { name: "Agent" });
    await within(panel).findByPlaceholderText(/^Reply…/);
    act(() => closeAgentPanel());
    await waitFor(() => expect(screen.queryByRole("complementary", { name: "Agent" })).toBeNull());
    act(() => toggleAgentPanel());
    const reopened = await screen.findByRole("complementary", { name: "Agent" });
    await within(reopened).findAllByText("Why did run 412 fail?");
    expect(within(reopened).queryByPlaceholderText(/^Reply…/)).toBeNull();
  });
});

describe("Agent panel with the Result panel", () => {
  it("writes a fix note quoting the result text", async () => {
    renderHost();
    act(() => publishAgentSubject(pr));
    act(() =>
      openAgentPanel({
        quote: { quote: "接続文字列", prefix: "a", suffix: "b", offset: 3, resultFile: "PR68.html", resultHash: "h" },
      }),
    );
    const panel = await screen.findByRole("complementary", { name: "Agent" });
    expect(within(panel).getByText("接続文字列")).toBeTruthy();
    fireEvent.change(await within(panel).findByPlaceholderText(/Ask about/), { target: { value: "直して" } });
    fireEvent.click(within(panel).getByRole("button", { name: "Ask" }));
    await waitFor(() =>
      expect(createAgentNote).toHaveBeenCalledWith(
        expect.objectContaining({ target: "pull-request", itemId: 68, quote: "接続文字列", quoteOffset: 3, kind: null, resultFile: "PR68.html" }),
      ),
    );
  });

  it("resolves the selected conversation with x", async () => {
    renderHost();
    const panel = await openPanel();
    const [waiting] = rows(panel);
    waiting.focus();
    fireEvent.keyDown(waiting, { key: "x" });
    await waitFor(() =>
      expect(setAgentNoteStatus).toHaveBeenCalledWith(
        expect.objectContaining({ target: "ask", itemId: 20261011090000, noteId: "a.md", status: "done" }),
      ),
    );
  });
});
