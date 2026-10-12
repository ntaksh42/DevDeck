import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentAsk, AgentNote } from "@/lib/azdoCommands";
import { AgentPanelHost } from "./AgentPanelHost";
import { buildContextDocument } from "./contextDocument";
import { publishAgentListScope, type AgentListScope } from "./agentListScope";
import { closeAgentPanel, registerDrawerHost, resetAgentPanelState } from "./agentPanelStore";
import { openAgentPanel, publishAgentSubject, toggleAgentPanel, type AgentSubject } from "./agentSubject";

function note(id: string, body: string, extra: Partial<AgentNote> = {}): AgentNote {
  return {
    id,
    status: "open",
    createdAt: "2026-10-11T09:00:00+09:00",
    modifiedAt: null,
    body,
    quote: null,
    quotePrefix: null,
    quoteSuffix: null,
    quoteOffset: null,
    resultFile: null,
    resultHash: null,
    kind: "investigate",
    context: null,
    contextFile: null,
    resolved: null,
    replies: [],
    filePath: `C:/notes/${id}`,
    ...extra,
  };
}

const asks: AgentAsk[] = [
  {
    itemId: 20261011090000,
    lastModifiedAt: "2026-10-11T09:06:00+09:00",
    notes: [
      note("a.md", "Why did run 412 fail?", {
        replies: [{ author: "claude", createdAt: "2026-10-11T09:06:00+09:00", body: "Which culture should the test pin?" }],
      }),
    ],
  },
  {
    itemId: 20261010080000,
    lastModifiedAt: "2026-10-10T08:00:00+09:00",
    notes: [note("b.md", "Summarize last week", { status: "done", kind: "summarize", resolved: "Summarized" })],
  },
];

const createAgentNote = vi.fn(async (input: unknown) => note("new.md", (input as { body: string }).body));
const runAgent = vi.fn(async (_input: unknown) => {});
const replyAgentNote = vi.fn(async (_input: unknown) => note("a.md", "x"));
const setAgentNoteStatus = vi.fn(async (_input: unknown) => note("a.md", "x"));

vi.mock("@/lib/azdoCommands", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/azdoCommands")>()),
  getAppSettings: vi.fn(async () => ({ readOnlyValidationModeEnabled: false })),
  listAgentAsks: vi.fn(async () => asks),
  listAgentNotes: vi.fn(async () => [note("pr.md", "Check the retry logic")]),
  createAgentNote: (input: unknown) => createAgentNote(input),
  replyAgentNote: (input: unknown) => replyAgentNote(input),
  runAgent: (input: unknown) => runAgent(input),
  setAgentNoteStatus: (input: unknown) => setAgentNoteStatus(input),
}));
vi.mock("./contextDocument", () => ({ buildContextDocument: vi.fn(async () => "# material") }));

afterEach(() => {
  cleanup();
  resetAgentPanelState();
  publishAgentSubject(null);
  publishAgentListScope(null);
  vi.mocked(buildContextDocument).mockClear();
  createAgentNote.mockClear();
  runAgent.mockClear();
  replyAgentNote.mockClear();
});

const pr: AgentSubject = {
  kind: "pull-request",
  id: 68,
  title: "Add ToDo API",
  projectId: "p",
  repositoryId: "r",
  repositoryName: "TestRepos",
  webUrl: null,
};

function renderHost() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <button type="button">grid</button>
      <AgentPanelHost />
    </QueryClientProvider>,
  );
}

/** Opens the panel and waits for a conversation: an ask without a subject, or the PR's own note. */
async function openPanel(conversation = "Why did run 412 fail?") {
  act(() => toggleAgentPanel());
  const panel = await screen.findByRole("complementary", { name: "Agent" });
  await within(panel).findAllByText(conversation);
  return panel;
}

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
    // Folded: status (screen-reader label) and first line only: no kind, reply count or time.
    expect(done.textContent).toBe("DoneSummarize last week");
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
});

const list: AgentListScope = { id: "my-reviews", label: "This list", count: 3, markdown: () => "## My Reviews (3)" };

describe("Agent panel context chips", () => {
  it("offers the view's list as a dashed chip and attaches it with Space", async () => {
    renderHost();
    act(() => publishAgentSubject(pr));
    act(() => publishAgentListScope(list));
    const panel = await openPanel("Check the retry logic");
    const toolbar = within(panel).getByRole("toolbar", { name: "Agent context" });
    expect(within(toolbar).getByText("Context")).toBeTruthy();
    const subjectChip = within(toolbar).getByRole("button", { name: "Attached: !68 Add ToDo API" });
    const listChip = within(toolbar).getByRole("button", { name: "Attach: This list (3)" });
    expect(listChip.textContent).toBe("+ This list (3)");
    expect(listChip.getAttribute("aria-pressed")).toBe("false");
    // One tab stop for the whole row.
    expect(subjectChip.tabIndex).toBe(0);
    expect(listChip.tabIndex).toBe(-1);

    subjectChip.focus();
    fireEvent.keyDown(subjectChip, { key: "ArrowRight" });
    expect(document.activeElement).toBe(listChip);
    expect(listChip.tabIndex).toBe(0);
    fireEvent.keyDown(listChip, { key: " " });
    const attached = within(toolbar).getByRole("button", { name: "Attached: This list (3)" });
    // The same element keeps the focus when it flips between dashed and solid.
    expect(attached).toBe(listChip);
    expect(document.activeElement).toBe(listChip);
    expect(listChip.getAttribute("aria-pressed")).toBe("true");
    // Not pinnable.
    fireEvent.keyDown(listChip, { key: "p" });
    expect(within(toolbar).getAllByRole("button", { name: "Pin the subject" })).toHaveLength(1);

    fireEvent.keyDown(listChip, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(subjectChip);
    fireEvent.keyDown(subjectChip, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(subjectChip);
  });

  it("pins with p, detaches and re-attaches the subject with Enter, and Esc returns to the input", async () => {
    renderHost();
    act(() => publishAgentSubject(pr));
    const panel = await openPanel("Check the retry logic");
    const chip = within(panel).getByRole("button", { name: "Attached: !68 Add ToDo API" });
    chip.focus();
    fireEvent.keyDown(chip, { key: "p" });
    expect(within(panel).getByRole("button", { name: "Unpin the subject" })).toBeTruthy();

    fireEvent.keyDown(chip, { key: "Enter" });
    const dashed = within(panel).getByRole("button", { name: "Attach: !68 Add ToDo API" });
    expect(dashed).toBe(chip);
    expect(dashed.textContent).toBe("+ !68 Add ToDo API");
    // Without a subject the request is a plain ask.
    expect(within(panel).getByRole("button", { name: /Ask the agent/ })).toBeTruthy();
    fireEvent.keyDown(dashed, { key: "Enter" });
    expect(within(panel).getByRole("button", { name: "Attached: !68 Add ToDo API" })).toBeTruthy();

    fireEvent.keyDown(chip, { key: "Escape" });
    await waitFor(() => expect(document.activeElement?.tagName).toBe("TEXTAREA"));
    // The panel stays open: Esc in the chips only goes back to the input.
    expect(screen.getByRole("complementary", { name: "Agent" })).toBeTruthy();
  });

  it("truncates a long subject title instead of widening the row", async () => {
    renderHost();
    act(() => publishAgentSubject({ ...pr, title: "A very long pull request title ".repeat(8) }));
    const panel = await openPanel("Check the retry logic");
    const chip = within(panel).getByRole("button", { name: /^Attached: !68 A very long/ });
    expect(chip.className).toContain("truncate");
    expect(chip.title).toContain("A very long pull request title");
  });

  it("sends the list with the request only when it is attached", async () => {
    renderHost();
    act(() => publishAgentSubject(pr));
    act(() => publishAgentListScope(list));
    const panel = await openPanel("Check the retry logic");

    fireEvent.change(within(panel).getByPlaceholderText(/Ask about/), { target: { value: "first" } });
    fireEvent.click(within(panel).getByRole("button", { name: "Ask" }));
    await waitFor(() => expect(createAgentNote).toHaveBeenCalledTimes(1));
    expect(buildContextDocument).toHaveBeenLastCalledWith(expect.objectContaining({ id: 68 }), null);

    fireEvent.click(within(panel).getByRole("button", { name: "Attach: This list (3)" }));
    fireEvent.click(await within(panel).findByRole("button", { name: /Ask about/ }));
    fireEvent.change(await within(panel).findByPlaceholderText(/Ask about/), { target: { value: "second" } });
    fireEvent.click(within(panel).getByRole("button", { name: "Ask" }));
    await waitFor(() => expect(createAgentNote).toHaveBeenCalledTimes(2));
    expect(buildContextDocument).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: 68 }),
      expect.objectContaining({ id: "my-reviews", count: 3 }),
    );
    expect(createAgentNote).toHaveBeenLastCalledWith(
      expect.objectContaining({
        target: "pull-request",
        context: expect.stringContaining("This list (3)"),
        contextDocument: "# material",
      }),
    );
  });

  it("asks about the list alone when there is no subject", async () => {
    renderHost();
    act(() => publishAgentListScope(list));
    const panel = await openPanel();
    fireEvent.click(within(panel).getByRole("button", { name: "Attach: This list (3)" }));
    fireEvent.change(await within(panel).findByPlaceholderText(/Ask the agent/), { target: { value: "Which are stale?" } });
    fireEvent.click(within(panel).getByRole("button", { name: "Ask" }));
    await waitFor(() => expect(createAgentNote).toHaveBeenCalled());
    expect(buildContextDocument).toHaveBeenLastCalledWith(null, expect.objectContaining({ id: "my-reviews" }));
    expect(createAgentNote).toHaveBeenLastCalledWith(
      expect.objectContaining({ target: "ask", context: "This list (3)", contextDocument: "# material" }),
    );
  });

  it("drops the attachment when another list takes over", async () => {
    renderHost();
    act(() => publishAgentListScope(list));
    const panel = await openPanel();
    fireEvent.click(within(panel).getByRole("button", { name: "Attach: This list (3)" }));
    expect(within(panel).getByRole("button", { name: "Attached: This list (3)" })).toBeTruthy();
    act(() => publishAgentListScope({ ...list, id: "inbox", count: 5 }));
    expect(within(panel).getByRole("button", { name: "Attach: This list (5)" })).toBeTruthy();
  });
});

describe("Agent drawer default", () => {
  it("shows the drawer for a view without a dock until the user closes it", async () => {
    // The test setup closes the panel before each test; start from the app's initial state.
    resetAgentPanelState();
    renderHost();
    expect(screen.queryByRole("complementary", { name: "Agent" })).toBeNull();
    let unregister = () => {};
    act(() => {
      unregister = registerDrawerHost("notifications");
    });
    expect(await screen.findByRole("complementary", { name: "Agent" })).toBeTruthy();
    // Shown by default, not opened: the first Ctrl+J closes it and it stays closed for the view.
    act(() => toggleAgentPanel());
    await waitFor(() => expect(screen.queryByRole("complementary", { name: "Agent" })).toBeNull());
    act(() => unregister());
  });
});
