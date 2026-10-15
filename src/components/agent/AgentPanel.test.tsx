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
    listAgentNotes: vi.fn(async () => [m.note("pr.md", "Check the retry logic")]),
    createAgentNote: (input: unknown) => m.createAgentNote(input),
    replyAgentNote: (input: unknown) => m.replyAgentNote(input),
    runAgent: (input: unknown) => m.runAgent(input),
    setAgentNoteStatus: (input: unknown) => m.setAgentNoteStatus(input),
  };
});
vi.mock("./contextDocument", () => ({ buildContextDocument: vi.fn(async () => "# material") }));

afterEach(resetFixtures);

describe("Agent panel", () => {
  it("opens focused on the input; Esc folds it, then closes and returns focus", async () => {
    renderHost();
    const grid = screen.getByRole("button", { name: "grid" });
    grid.focus();
    const panel = await openPanel();
    await waitFor(() => expect(document.activeElement?.tagName).toBe("TEXTAREA"));
    // Esc folds the empty input back to the conversation list, a second Esc closes.
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    await waitFor(() => expect(document.activeElement?.hasAttribute("aria-expanded")).toBe(true));
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("complementary", { name: "Agent" })).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(grid));
    expect(panel.isConnected).toBe(false);
  });

  it("folds each conversation; waiting ones start open and done ones folded", async () => {
    renderHost();
    const panel = await openPanel();
    const [waiting, done] = within(panel).getAllByRole("button").filter((b) => b.hasAttribute("aria-expanded"));
    expect(waiting.getAttribute("aria-expanded")).toBe("true");
    expect(within(panel).getByText("Which culture should the test pin?")).toBeTruthy();
    expect(done.getAttribute("aria-expanded")).toBe("false");

    waiting.focus();
    fireEvent.keyDown(waiting, { key: "ArrowLeft" });
    expect(waiting.getAttribute("aria-expanded")).toBe("false");
    expect(within(panel).queryByText("Which culture should the test pin?")).toBeNull();
    fireEvent.keyDown(waiting, { key: "ArrowDown" });
    expect(document.activeElement).toBe(done);
    fireEvent.keyDown(done, { key: "ArrowRight" });
    expect(done.getAttribute("aria-expanded")).toBe("true");
    expect(within(panel).getByText("✓ Summarized")).toBeTruthy();
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
    expect((await within(panel).findAllByText("Check the retry logic")).length).toBeGreaterThan(0);
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

  it("replies to the selected conversation with r, in the box under it", async () => {
    renderHost();
    const panel = await openPanel();
    const [waiting] = within(panel).getAllByRole("button").filter((b) => b.hasAttribute("aria-expanded"));
    waiting.focus();
    fireEvent.keyDown(waiting, { key: "r" });
    const input = await within(panel).findByPlaceholderText(/^Reply…/);
    await waitFor(() => expect(document.activeElement).toBe(input));
    // The box sits inside the conversation, and typing in it does not trigger list keys.
    expect(input.closest("[data-agent-conversation]")).toBe(waiting.closest("[data-agent-conversation]"));
    fireEvent.keyDown(input, { key: "x" });
    expect(setAgentNoteStatus).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: "Pin en-US" } });
    fireEvent.click(within(panel).getByRole("button", { name: "Reply" }));
    await waitFor(() => expect(replyAgentNote).toHaveBeenCalledWith(
      expect.objectContaining({ target: "ask", itemId: 20261011090000, noteId: "a.md", body: "Pin en-US" }),
    ));
    expect(runAgent).toHaveBeenCalled();
  });

  it("gives every open conversation its own reply box and Esc returns to its header", async () => {
    renderHost();
    const panel = await openPanel();
    const [waiting, done] = within(panel).getAllByRole("button").filter((b) => b.hasAttribute("aria-expanded"));
    // Unfolded conversations carry a one-line reply box; folded ones carry none.
    expect(within(waiting.closest("[data-agent-conversation]") as HTMLElement).getByRole("button", { name: /^Reply…/ })).toBeTruthy();
    expect(within(done.closest("[data-agent-conversation]") as HTMLElement).queryByRole("button", { name: /^Reply…/ })).toBeNull();

    fireEvent.click(within(waiting.closest("[data-agent-conversation]") as HTMLElement).getByRole("button", { name: /^Reply…/ }));
    const input = await within(panel).findByPlaceholderText(/^Reply…/);
    await waitFor(() => expect(document.activeElement).toBe(input));
    fireEvent.keyDown(input, { key: "Escape" });
    await waitFor(() => expect(document.activeElement).toBe(waiting));
  });

  it("Esc on the folded reply button returns to its conversation header and keeps the panel", async () => {
    renderHost();
    const panel = await openPanel();
    const [waiting] = within(panel).getAllByRole("button").filter((b) => b.hasAttribute("aria-expanded"));
    const replyButton = within(waiting.closest("[data-agent-conversation]") as HTMLElement).getByRole("button", { name: /^Reply…/ });
    replyButton.focus();
    fireEvent.keyDown(replyButton, { key: "Escape" });
    expect(document.activeElement).toBe(waiting);
    expect(screen.getByRole("complementary", { name: "Agent" })).toBeTruthy();
  });

  it("Ctrl+J closing a panel whose opener has gone lands on the view's grid", async () => {
    resetAgentPanelState();
    const { rerender } = render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <div data-primary-grid="true">
          <div role="row" aria-selected="true" tabIndex={0} data-testid="row" />
        </div>
        <button type="button">Ask agent</button>
        <AgentPanelHost />
      </QueryClientProvider>,
    );
    // Opened from a dialog button that closes as the panel opens.
    screen.getByRole("button", { name: "Ask agent" }).focus();
    act(() => openAgentPanel({}));
    await screen.findByRole("complementary", { name: "Agent" });
    rerender(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <div data-primary-grid="true">
          <div role="row" aria-selected="true" tabIndex={0} data-testid="row" />
        </div>
        <AgentPanelHost />
      </QueryClientProvider>,
    );
    act(() => toggleAgentPanel());
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId("row")));
  });

  it("Esc on a header closes a panel opened from <body> and lands on the view's grid", async () => {
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
    const [waiting] = within(panel).getAllByRole("button").filter((b) => b.hasAttribute("aria-expanded"));
    waiting.focus();
    fireEvent.keyDown(waiting, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("complementary", { name: "Agent" })).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId("row")));
  });

  it("Delete on a header moves focus to the next conversation, then to the input when none are left", async () => {
    renderHost();
    const panel = await openPanel();
    const headers = () => within(panel).getAllByRole("button").filter((b) => b.hasAttribute("aria-expanded") && b.closest("[data-agent-conversation]"));
    const [waiting, done] = headers();
    waiting.focus();
    fireEvent.keyDown(waiting, { key: "Delete" });
    await waitFor(() => expect(deleteAgentNote).toHaveBeenCalledWith(expect.objectContaining({ noteId: "a.md" })));
    await waitFor(() => expect(headers()).toHaveLength(1));
    await waitFor(() => expect(document.activeElement).toBe(done));

    // The last open conversation: nothing is left to focus, so the input takes it.
    state.asks = [{ ...asks[0], notes: [note("c.md", "Only one")] }];
    cleanup();
    const second = renderHost();
    const only = await second.findByText("Only one");
    const header = only.closest("[data-agent-conversation]")!.querySelector("button")!;
    header.focus();
    fireEvent.keyDown(header, { key: "Delete" });
    await waitFor(() => expect(second.queryByText("Only one")).toBeNull());
    await waitFor(() => expect(document.activeElement?.closest("[data-agent-composer]")).not.toBeNull());
  });
});

describe("Agent panel keys", () => {
  it("lists urgent conversations first and shows no kind, count or time on a folded row", async () => {
    renderHost();
    const panel = await openPanel();
    const [waiting, done] = within(panel).getAllByRole("button").filter((b) => b.hasAttribute("aria-expanded"));
    // Expanded, the header names who/when/kind and the message below shows the text once.
    expect(waiting.getAttribute("aria-expanded")).toBe("true");
    expect(waiting.textContent).toContain("You · ");
    expect(within(panel).getAllByText("Why did run 412 fail?")).toHaveLength(1);
    // Folded like a PR thread: avatar, first line and state pill; no kind or time.
    expect(done.textContent).toBe("YOSummarize last weekDone");
  });

  it("pins with p and runs the agent now with Shift+Enter", async () => {
    renderHost();
    act(() => publishAgentSubject(pr));
    const panel = await openPanel("Check the retry logic");
    const [first] = within(panel).getAllByRole("button").filter((b) => b.hasAttribute("aria-expanded"));
    first.focus();
    fireEvent.keyDown(first, { key: "p" });
    act(() => publishAgentSubject(null));
    expect(within(panel).getByRole("button", { name: "Unpin the subject" })).toBeTruthy();

    fireEvent.keyDown(first, { key: "Enter", shiftKey: true });
    await waitFor(() => expect(runAgent).toHaveBeenCalled());
    expect(createAgentNote).not.toHaveBeenCalled();
  });
});

describe("Agent panel M key", () => {
  it("moves from the conversation list to a new request with m", async () => {
    renderHost();
    const panel = await openPanel();
    const [first] = within(panel).getAllByRole("button").filter((b) => b.hasAttribute("aria-expanded"));
    first.focus();
    fireEvent.keyDown(first, { key: "r" });
    await within(panel).findByPlaceholderText(/^Reply…/);
    first.focus();
    fireEvent.keyDown(first, { key: "m" });
    const input = await within(panel).findByPlaceholderText(/Ask the agent/);
    await waitFor(() => expect(document.activeElement).toBe(input));
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
    const [waiting] = within(panel).getAllByRole("button").filter((b) => b.hasAttribute("aria-expanded"));
    waiting.focus();
    fireEvent.keyDown(waiting, { key: "x" });
    await waitFor(() =>
      expect(setAgentNoteStatus).toHaveBeenCalledWith(
        expect.objectContaining({ target: "ask", itemId: 20261011090000, noteId: "a.md", status: "done" }),
      ),
    );
  });
  it("drops a failed start once the selection moves to another subject", async () => {
    renderHost();
    act(() => publishAgentSubject(pr));
    const panel = await openPanel("Check the retry logic");
    runAgent.mockRejectedValueOnce({ message: "An agent is already running in C:/repos/TestRepos" });
    fireEvent.change(within(panel).getByPlaceholderText(/Ask about/), { target: { value: "Review this" } });
    fireEvent.click(within(panel).getByRole("button", { name: "Ask" }));
    expect(await within(panel).findByText(/already running/)).toBeTruthy();

    act(() => publishAgentSubject({ kind: "pull-request", id: 69, repositoryName: "TestRepos", title: "Other PR", projectId: "p", repositoryId: "r", webUrl: null }));
    await waitFor(() => expect(within(panel).queryByText(/already running/)).toBeNull());
  });
});
