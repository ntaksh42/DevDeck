import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Bot, X } from "lucide-react";
import { commandErrorMessage, noteNeedsYou } from "@/lib/azdoCommands";
import { ErrorState, LoadingState } from "@/components/StateDisplay";
import { RowShortcutHints } from "@/components/RowShortcutHints";
import { AgentChat } from "./AgentChat";
import { AgentComposerFooter } from "./AgentComposerFooter";
import { AgentConversationList } from "./AgentConversationList";
import { AgentContextChips } from "./AgentContextChips";
import { AgentPicker } from "./AgentPicker";
import { AgentProposalTray } from "./AgentProposalTray";
import { useAgentListScope } from "./agentListScope";
import { handlePaneFocusKey } from "@/lib/paneFocus";
import { focusPrimaryGrid } from "@/lib/utils";
import {
  noteItemOf,
  requestNoteReattach,
  requestNoteReveal,
  subjectKey,
  subjectLabel,
  useAgentSubject,
  type AgentQuote,
} from "./agentSubject";
import { consumeAgentFocusRequest, focusAgentComposer, type SubjectOverride } from "./agentPanelStore";
import { useAgentPanelData, type AgentChoice, type Conversation } from "./useAgentPanelData";
import { pendingProposals } from "./agentProposals";
import { proposalCodeContext, useAgentProposals } from "./useAgentProposals";

const LIST_KEYS = [
  { keys: "↑↓", label: "move" },
  { keys: "Enter", label: "open" },
  { keys: "R", label: "reply" },
  { keys: "M", label: "ask" },
  { keys: "X", label: "resolve" },
  { keys: "C", label: "post comment" },
  { keys: "⇧Enter", label: "run now" },
  { keys: "P", label: "pin" },
  { keys: "⇧Tab", label: "agent / context (from the input)" },
  { keys: "Esc", label: "close" },
];
const CHAT_KEYS = [
  { keys: "Esc", label: "back to the list" },
  { keys: "R", label: "reply" },
  { keys: "C", label: "post comment" },
  { keys: "X", label: "resolve" },
  { keys: "Enter", label: "show in result" },
  { keys: "⇧Enter", label: "run now" },
  { keys: "M", label: "ask something new" },
];

/**
 * The app-wide Agent panel (Ctrl+J): asks the external agent to investigate,
 * summarize or answer something about the item selected in any view, or about
 * nothing in particular. It shows either the list of conversations or one
 * conversation over its whole height, like a chat (Enter opens one, Esc goes
 * back). One input sits at the bottom: on the list it asks something new, in a
 * conversation it replies there. Comments the agent proposes wait in a tray
 * above the input until they are posted.
 */
export function AgentPanel({
  docked = false,
  override,
  onOverrideChange,
  listAttached,
  onListAttachedChange,
  focusAskId,
  replyRequest,
  quote,
  focusNoteId,
  onClearQuote,
  onClose,
}: {
  /** Inside a dock panel (fills it) rather than the right-edge drawer. */
  docked?: boolean;
  override: SubjectOverride;
  onOverrideChange: (next: SubjectOverride) => void;
  /** Id of the view list attached as context, if any. */
  listAttached: string | null;
  onListAttachedChange: (next: string | null) => void;
  /** Open this request when it appears. */
  focusAskId: number | null;
  /** Bumped to start replying to the selected (or waiting) conversation. */
  replyRequest: number;
  /** Result text the next new note quotes (from the Result panel). */
  quote: AgentQuote | null;
  /** Note of the subject item to open (a pin clicked in the result). */
  focusNoteId: string | null;
  onClearQuote: () => void;
  onClose: () => void;
}) {
  const live = useAgentSubject();
  const subject = override ? override.subject : live;
  const liveList = useAgentListScope();
  const attachedList = liveList && listAttached === liveList.id ? liveList : null;
  // The agent and model picked for the next send; null follows Settings.
  const [choice, setChoice] = useState<AgentChoice>({ agent: null, model: null });
  const resetChoice = () => setChoice({ agent: null, model: null });
  const data = useAgentPanelData(subject, true, attachedList, choice);
  const { conversations } = data;
  const proposals = useAgentProposals(subject, conversations, { autoPost: data.autoPost, readOnly: data.readOnly });

  const [help, setHelp] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const rowRefs = useRef(new Map<string, HTMLButtonElement>());
  const chatRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // A conversation that left the list (deleted, another subject) shows the list again.
  const open = conversations.find((c) => c.key === openKey) ?? null;
  const selected = open ?? conversations.find((c) => c.key === selectedKey) ?? conversations[0] ?? null;
  // Run now: the open or selected conversation's notes, else the subject's.
  const runTarget = selected?.item ?? noteItemOf(subject);
  const pinned = override !== null;
  const togglePin = () => onOverrideChange(pinned ? null : subject ? { subject } : null);

  // Focus moves after the render that shows its target.
  const [focusTarget, setFocusTarget] = useState<{ to: "list" | "chat" | "composer"; n: number }>({ to: "list", n: 0 });
  const focusLater = (to: "list" | "chat" | "composer") => setFocusTarget((prev) => ({ to, n: prev.n + 1 }));
  useEffect(() => {
    if (!focusTarget.n) return;
    if (focusTarget.to === "composer") focusAgentComposer();
    else if (focusTarget.to === "chat") chatRef.current?.focus();
    else {
      const row = selected && !open ? rowRefs.current.get(selected.key) : undefined;
      (row ?? listRef.current)?.focus();
    }
  }, [focusTarget]); // eslint-disable-line react-hooks/exhaustive-deps

  // A panel that was already open when it remounts (moved to another view) leaves the focus where it is.
  useEffect(() => {
    if (consumeAgentFocusRequest()) focusLater("composer");
  }, []);

  function openConversation(c: Conversation, reply = false): void {
    setSelectedKey(c.key);
    setOpenKey(c.key);
    focusLater(reply ? "composer" : "chat");
  }
  function backToList(): void {
    setOpenKey(null);
    focusLater("list");
  }
  /** A new request: the list with its input. */
  function askNew(): void {
    setOpenKey(null);
    focusLater("composer");
  }

  // Opened on a request (e.g. from the Inbox): show it and answer it.
  useEffect(() => {
    if (focusAskId === null) return;
    const match = conversations.find((c) => c.section === "ask" && c.item.itemId === focusAskId);
    if (match) openConversation(match, noteNeedsYou(match.note));
  }, [focusAskId, conversations.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // A quote from the Result panel starts a note about it.
  useEffect(() => {
    if (quote) askNew();
  }, [quote]);

  // A pin clicked in the result opens its note.
  useEffect(() => {
    if (!focusNoteId) return;
    const match = conversations.find((c) => c.section === "item" && c.note.id === focusNoteId);
    if (match) openConversation(match);
  }, [focusNoteId, conversations.length]); // eslint-disable-line react-hooks/exhaustive-deps

  /** What can be done to a conversation; the keys mirror these. */
  function actionsOf(c: Conversation) {
    const request = { ...c.item, noteId: c.note.id };
    const inResult = c.section === "item" && (!!c.note.quote || c.note.status === "done");
    return [
      ...(inResult ? [{ label: "Show in result", keys: "Enter", run: () => requestNoteReveal(request) }] : []),
      ...(c.section === "item" && c.note.status !== "done"
        ? [{ label: "Re-attach", keys: "L", run: () => requestNoteReattach(request) }]
        : []),
      ...(c.note.status !== "draft"
        ? [{ label: c.note.status === "done" ? "Reopen" : "Resolve", keys: "X", run: () => data.setStatus.mutate(c) }]
        : []),
      ...(c.note.status !== "done" ? [{ label: "Delete", keys: "Del", run: () => deleteConversation(c) }] : []),
      ...(c.section === "item" && pendingProposals(c.note)[0]
        ? [{ label: "Post comment", keys: "C", run: () => proposals.post(c, pendingProposals(c.note)[0].index) }]
        : []),
    ];
  }

  // After a delete, the list shows again with focus on the neighbouring row
  // (or the input when none is left) once the conversation has left it.
  const afterDelete = useRef<{ gone: string; next: string | null } | null>(null);
  useEffect(() => {
    const pending = afterDelete.current;
    if (!pending || conversations.some((c) => c.key === pending.gone)) return;
    afterDelete.current = null;
    setOpenKey(null);
    const target = pending.next ?? conversations[0]?.key ?? null;
    if (target) {
      setSelectedKey(target);
      focusLater("list");
    } else {
      focusLater("composer");
    }
  }, [conversations]); // eslint-disable-line react-hooks/exhaustive-deps

  function deleteConversation(c: Conversation): void {
    const index = conversations.indexOf(c);
    afterDelete.current = { gone: c.key, next: (conversations[index + 1] ?? conversations[index - 1])?.key ?? null };
    data.remove.mutate(c, {
      onError: () => {
        afterDelete.current = null;
      },
    });
  }

  // Answer the selected (or waiting) conversation once it has loaded.
  const handledReply = useRef(0);
  useEffect(() => {
    if (!replyRequest || handledReply.current === replyRequest) return;
    const target = open ?? conversations.find((c) => c.key === selectedKey) ?? conversations.find((c) => noteNeedsYou(c.note));
    if (!target) return;
    handledReply.current = replyRequest;
    openConversation(target, true);
  }, [replyRequest, conversations.length]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Keys shared by the list (on a row) and an open conversation; true when handled. */
  function conversationKey(event: ReactKeyboardEvent<HTMLElement>, current: Conversation | null): boolean {
    const plain = !event.ctrlKey && !event.metaKey && !event.altKey;
    const lower = event.key.toLowerCase();
    const action = (label: string) => (current ? actionsOf(current).find((a) => a.label === label) : undefined);
    let run: (() => void) | undefined;
    if ((event.ctrlKey || event.metaKey) && lower === "z" && data.deleted) run = () => data.undoDelete.mutate();
    else if (event.key === "Enter" && event.shiftKey) {
      // Shift+Enter: run the agent now on the open notes, without a new request.
      run = () => {
        if (runTarget && !data.readOnly) data.runNow.mutate(runTarget);
      };
    } else if (plain && lower === "l") run = action("Re-attach")?.run;
    else if (plain && lower === "c") run = action("Post comment")?.run;
    else if (plain && lower === "x") run = (action("Resolve") ?? action("Reopen"))?.run;
    else if (event.key === "Delete") run = action("Delete")?.run;
    else if (plain && lower === "m") run = askNew;
    else if (plain && lower === "r" && current) run = () => openConversation(current, true);
    else if (event.key === "?") run = () => setHelp((value) => !value);
    else if (plain && lower === "p" && (subject || pinned)) run = togglePin;
    if (!run) return false;
    event.preventDefault();
    event.stopPropagation();
    run();
    return true;
  }

  function onListKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void {
    // The focused row decides, even before its focus has re-rendered.
    const focusedKey = conversations.find((c) => rowRefs.current.get(c.key) === event.target)?.key;
    const index = conversations.findIndex((c) => c.key === (focusedKey ?? selected?.key));
    const current = conversations[index] ?? null;
    if (conversationKey(event, current)) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      event.stopPropagation();
      const next = conversations[Math.max(0, Math.min(conversations.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)))];
      if (!next) return;
      setSelectedKey(next.key);
      rowRefs.current.get(next.key)?.focus();
    } else if (event.key === "Enter" && current) {
      event.preventDefault();
      event.stopPropagation();
      openConversation(current);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      // Closing hands focus back to where the panel was opened from. When that
      // place is gone (or was <body>), land on the view's grid, not <body>.
      window.setTimeout(() => {
        const active = document.activeElement;
        if (!active || active === document.body) focusPrimaryGrid();
      }, 0);
    }
  }

  function onChatKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void {
    if (!open || conversationKey(event, open)) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      backToList();
    } else if (event.key === "Enter") {
      const reveal = actionsOf(open).find((a) => a.label === "Show in result");
      if (!reveal) return;
      event.preventDefault();
      event.stopPropagation();
      reveal.run();
    }
  }

  const drafts = conversations.filter((c) => c.section === "item" && c.note.status === "draft").length;
  const failure = data.error ?? data.send.error ?? data.runNow.error;
  const error = failure ? commandErrorMessage(failure) : null;
  const starting = data.send.isPending || data.runNow.isPending;

  return (
    <aside
      aria-label="Agent"
      data-agent-panel="true"
      data-pane-editable="true"
      data-focus-pane={docked ? undefined : "agent"}
      tabIndex={-1}
      onKeyDownCapture={handlePaneFocusKey}
      data-agent-subject={subjectKey(subject)}
      // min-h-0 / overflow-hidden: inside a dock panel the list scrolls, not the whole panel.
      className={`flex h-full min-h-0 flex-col overflow-hidden bg-card text-xs ${docked ? "w-full min-w-0" : "w-[360px] shrink-0 border-l border-border"}`}
      onKeyDown={(event) => {
        // Keep the panel's keys away from the grid underneath.
        if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Enter"].includes(event.key)) event.stopPropagation();
      }}
    >
      {/* Docked, the tab already names the panel and closes it. */}
      {docked || open ? null : (
        <div className="flex shrink-0 items-center gap-1.5 border-b border-border px-2 py-1">
          <Bot className="h-4 w-4" aria-hidden="true" />
          <span className="text-sm font-semibold">Agent</span>
          <span className="text-2xs text-muted-foreground">Ctrl+J</span>
          <span className="flex-1" />
          <button type="button" onClick={onClose} title="Close (Esc)" aria-label="Close the agent panel" className="rounded p-0.5 hover:bg-accent">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {open ? (
        <AgentChat
          ref={chatRef}
          conversation={open}
          onBack={backToList}
          actions={actionsOf(open)}
          onKeyDown={onChatKeyDown}
          codeContext={proposalCodeContext(subject, open.item)}
        />
      ) : (
        <div
          ref={listRef}
          tabIndex={-1}
          aria-label="Agent conversations"
          data-pane-focus-target="true"
          className="min-h-0 flex-1 overflow-y-auto px-1.5 py-1 outline-none"
          onKeyDown={onListKeyDown}
        >
          {data.loading ? <LoadingState /> : null}
          <AgentConversationList
            conversations={conversations}
            selectedKey={selected?.key ?? null}
            rowRef={(key, el) => {
              if (el) rowRefs.current.set(key, el);
              else rowRefs.current.delete(key);
            }}
            onOpen={(c) => openConversation(c)}
            onFocusRow={(c) => setSelectedKey(c.key)}
          />
          {!data.loading && !conversations.length ? (
            <p className="px-1 py-2 text-muted-foreground">No conversations yet. Ask below; the agent replies here.</p>
          ) : null}
        </div>
      )}
      {error ? <ErrorState message={error} /> : null}
      {data.deleted ? (
        <p className="shrink-0 px-2 py-0.5 text-2xs text-muted-foreground">
          Deleted.{" "}
          <button type="button" onClick={() => data.undoDelete.mutate()} className="text-primary underline">
            Undo (Ctrl+Z)
          </button>
        </p>
      ) : null}
      {open ? (
        <AgentProposalTray
          note={open.note}
          onPost={open.section === "item" ? (replyIndex) => proposals.post(open, replyIndex) : null}
          busy={proposals.busy}
          error={proposals.errorFor(open.key)}
          autoPost={data.autoPost}
          codeContext={proposalCodeContext(subject, open.item)}
        />
      ) : null}
      {help || starting ? (
        <div className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-0.5 border-t border-border px-2 py-0.5 text-2xs text-muted-foreground">
          {help ? <RowShortcutHints hints={open ? CHAT_KEYS : LIST_KEYS} /> : null}
          {starting ? <span>Starting…</span> : null}
        </div>
      ) : null}

      <AgentComposerFooter
        composerKey={open?.key ?? "new"}
        placeholder={open ? "Reply… (R)" : subject ? `Ask about ${subjectLabel(subject)}… (M)` : "Ask the agent… (M)"}
        submitLabel={open ? "Reply" : "Ask"}
        busy={data.send.isPending}
        onSubmit={async (body) => {
          await data.send.mutateAsync({ body, replyTo: open, quote: open ? null : quote });
          if (!open) onClearQuote();
          resetChoice();
        }}
        onCollapse={() => (open ? chatRef.current?.focus() : focusLater("list"))}
        help={help}
        onToggleHelp={() => setHelp((value) => !value)}
        drafts={drafts}
        onSendDrafts={() => data.submitDrafts.mutate()}
        sendingDrafts={data.submitDrafts.isPending}
        quote={open ? null : quote}
        onClearQuote={onClearQuote}
        readOnly={data.readOnly}
        chips={
          open ? null : (
            <AgentContextChips
              subject={subject}
              offered={override && !override.subject ? live : null}
              pinned={!!override?.subject}
              list={liveList}
              listAttached={!!attachedList}
              onTogglePin={togglePin}
              onSubjectChange={(attach) => onOverrideChange(attach ? null : { subject: null })}
              onListAttachedChange={(attach) => onListAttachedChange(attach && liveList ? liveList.id : null)}
              onEscape={focusAgentComposer}
            />
          )
        }
        picker={
          data.readOnly ? null : (
            <AgentPicker
              value={data.agent}
              defaultAgent={data.defaultAgent}
              onChange={(agent) => setChoice({ agent, model: null })}
              model={data.model}
              models={data.modelChoices}
              onModelChange={(model) => setChoice((prev) => ({ ...prev, model }))}
              onEscape={focusAgentComposer}
            />
          )
        }
      />
    </aside>
  );
}
