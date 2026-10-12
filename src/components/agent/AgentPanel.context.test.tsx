import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildContextDocument } from "./contextDocument";
import { publishAgentListScope, type AgentListScope } from "./agentListScope";
import { resetAgentPanelState, registerDrawerHost } from "./agentPanelStore";
import { publishAgentSubject, toggleAgentPanel } from "./agentSubject";
import { createAgentNote, openPanel, pr, renderHost, resetFixtures } from "./agentPanelTestFixtures";

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
