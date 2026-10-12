import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentAsk, AgentNote } from "@/lib/azdoCommands";
import { AgentPanelHost } from "./AgentPanelHost";
import { closeAgentPanel, resetAgentPanelState } from "./agentPanelStore";
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

async function openPanel() {
  act(() => toggleAgentPanel());
  const panel = await screen.findByRole("complementary", { name: "Agent" });
  await within(panel).findAllByText("Why did run 412 fail?");
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
    const panel = await openPanel();
    // Following the selection shows no chip; the subject is in the input's placeholder.
    expect(within(panel).getByPlaceholderText("Ask about !68 Add ToDo API… (M)")).toBeTruthy();
    expect(within(panel).queryByText("!68 Add ToDo API")).toBeNull();
    expect((await within(panel).findAllByText("Check the retry logic")).length).toBeGreaterThan(0);

    fireEvent.click(within(panel).getByRole("button", { name: "Show keys and subject options" }));
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
    expect(within(panel).getByText(/No subject/)).toBeTruthy();
    // The input is folded after sending; its button carries the placeholder.
    expect(within(panel).getByRole("button", { name: /Ask the agent/ })).toBeTruthy();
  });

  it("replies to the selected conversation with r", async () => {
    renderHost();
    const panel = await openPanel();
    const [waiting] = within(panel).getAllByRole("button").filter((b) => b.hasAttribute("aria-expanded"));
    waiting.focus();
    fireEvent.keyDown(waiting, { key: "r" });
    const input = await within(panel).findByPlaceholderText(/Reply to the agent/);
    await waitFor(() => expect(document.activeElement).toBe(input));
    fireEvent.change(input, { target: { value: "Pin en-US" } });
    fireEvent.click(within(panel).getByRole("button", { name: "Reply" }));
    await waitFor(() => expect(replyAgentNote).toHaveBeenCalledWith(
      expect.objectContaining({ target: "ask", itemId: 20261011090000, noteId: "a.md", body: "Pin en-US" }),
    ));
    expect(runAgent).toHaveBeenCalled();
  });
});

describe("Agent panel keys", () => {
  it("lists urgent conversations first and shows no kind, count or time on a row", async () => {
    renderHost();
    const panel = await openPanel();
    const [waiting, done] = within(panel).getAllByRole("button").filter((b) => b.hasAttribute("aria-expanded"));
    expect(waiting.textContent).toContain("Why did run 412 fail?");
    // Status (screen-reader label) and first line only: no kind, reply count or time.
    expect(done.textContent).toBe("DoneSummarize last week");
  });

  it("pins with p and runs the agent now with Shift+Enter", async () => {
    renderHost();
    act(() => publishAgentSubject(pr));
    const panel = await openPanel();
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
    await within(panel).findByPlaceholderText(/Reply to the agent/);
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
    await within(panel).findByPlaceholderText(/Reply to the agent/);
    act(() => closeAgentPanel());
    await waitFor(() => expect(screen.queryByRole("complementary", { name: "Agent" })).toBeNull());
    act(() => toggleAgentPanel());
    const reopened = await screen.findByRole("complementary", { name: "Agent" });
    await within(reopened).findAllByText("Why did run 412 fail?");
    expect(within(reopened).queryByPlaceholderText(/Reply to the agent/)).toBeNull();
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
