import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Bot, X } from "lucide-react";
import { commandErrorMessage, noteNeedsYou } from "@/lib/azdoCommands";
import { CommentComposer } from "@/features/pull-requests/CommentComposer";
import { ErrorState, LoadingState } from "@/components/StateDisplay";
import { RowShortcutHints } from "@/components/RowShortcutHints";
import { AgentConversation, lastActivity } from "./AgentConversation";
import { AgentContextChips } from "./AgentContextChips";
import { useAgentListScope } from "./agentListScope";
import { handlePaneFocusKey } from "@/lib/paneFocus";
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
import { useAgentPanelData, type Conversation } from "./useAgentPanelData";

/**
 * The app-wide Agent panel (Ctrl+J): asks the external agent to investigate,
 * summarize or answer something about the item selected in any view, or about
 * nothing in particular. Each conversation folds to one line. Only the
 * conversations, the context chips and one input are always shown; the drafts
 * banner and quote appear when they apply, and `?` lists the keys.
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
  /** Expand and select this request when it appears. */
  focusAskId: number | null;
  /** Bumped to start replying to the selected (or waiting) conversation. */
  replyRequest: number;
  /** Result text the next new note quotes (from the Result panel). */
  quote: AgentQuote | null;
  /** Note of the subject item to select (a pin clicked in the result). */
  focusNoteId: string | null;
  onClearQuote: () => void;
  onClose: () => void;
}) {
  const live = useAgentSubject();
  const subject = override ? override.subject : live;
  const liveList = useAgentListScope();
  const attachedList = liveList && listAttached === liveList.id ? liveList : null;
  const data = useAgentPanelData(subject, true, attachedList);
  const { conversations } = data;

  const [help, setHelp] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [replyKey, setReplyKey] = useState<string | null>(null);
  const headerRefs = useRef(new Map<string, HTMLButtonElement>());
  const composerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Needs you and the most recent conversation start open; the rest fold.
  const latestKey = useMemo(
    () =>
      conversations.reduce<Conversation | null>(
        (best, c) => (!best || lastActivity(c.note) > lastActivity(best.note) ? c : best),
        null,
      )?.key ?? null,
    [conversations],
  );
  const isExpanded = (c: Conversation) =>
    expanded[c.key] ?? (c.note.status !== "done" && (noteNeedsYou(c.note) || c.key === latestKey));
  const toggle = (c: Conversation, value = !isExpanded(c)) => setExpanded((prev) => ({ ...prev, [c.key]: value }));

  const selected = conversations.find((c) => c.key === selectedKey) ?? null;
  const replyTo = conversations.find((c) => c.key === replyKey) ?? null;
  // Run now: the selected conversation's notes, else the subject's.
  const runTarget = selected?.item ?? noteItemOf(subject);
  const pinned = override !== null;
  const togglePin = () => onOverrideChange(pinned ? null : subject ? { subject } : null);

  const focusComposer = focusAgentComposer;
  function focusList(): void {
    const key = selectedKey ?? conversations[0]?.key;
    const header = key ? headerRefs.current.get(key) : undefined;
    if (header) header.focus();
    else listRef.current?.focus();
  }

  // Focus after the render: replying swaps in a fresh composer. A panel shown
  // by default (not opened by the user) leaves the focus where it is.
  const [composerFocus, setComposerFocus] = useState(0);
  useEffect(() => {
    if (composerFocus) focusComposer();
  }, [composerFocus]);
  const requestComposerFocus = () => setComposerFocus((n) => n + 1);
  useEffect(() => {
    if (consumeAgentFocusRequest()) requestComposerFocus();
  }, []);

  // Opened on a request (e.g. from the Inbox): show it and answer it.
  useEffect(() => {
    if (focusAskId === null) return;
    const match = conversations.find((c) => c.section === "ask" && c.item.itemId === focusAskId);
    if (!match) return;
    setSelectedKey(match.key);
    toggle(match, true);
    if (noteNeedsYou(match.note)) setReplyKey(match.key);
  }, [focusAskId, conversations.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // A quote from the Result panel starts a note about it.
  useEffect(() => {
    if (!quote) return;
    setReplyKey(null);
    requestComposerFocus();
  }, [quote]);

  // A pin clicked in the result selects its note here.
  useEffect(() => {
    if (!focusNoteId) return;
    const match = conversations.find((c) => c.section === "item" && c.note.id === focusNoteId);
    if (!match) return;
    setSelectedKey(match.key);
    toggle(match, true);
    window.setTimeout(() => headerRefs.current.get(match.key)?.focus(), 0);
  }, [focusNoteId, conversations.length]); // eslint-disable-line react-hooks/exhaustive-deps

  /** What can be done to a conversation; the list keys mirror these. */
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
      ...(c.note.status !== "done" ? [{ label: "Delete", keys: "Del", run: () => data.remove.mutate(c) }] : []),
    ];
  }

  // Answer the waiting conversation once it has loaded.
  const handledReply = useRef(0);
  useEffect(() => {
    if (!replyRequest || handledReply.current === replyRequest) return;
    const target = selected ?? conversations.find((c) => noteNeedsYou(c.note)) ?? null;
    if (!target) return;
    handledReply.current = replyRequest;
    setSelectedKey(target.key);
    setReplyKey(target.key);
    toggle(target, true);
    requestComposerFocus();
  }, [replyRequest, conversations.length]); // eslint-disable-line react-hooks/exhaustive-deps

  function onListKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void {
    // The focused header decides, even before its focus has re-rendered.
    const focusedKey = conversations.find((c) => headerRefs.current.get(c.key) === event.target)?.key;
    const index = conversations.findIndex((c) => c.key === (focusedKey ?? selectedKey));
    const move = (next: number) => {
      const c = conversations[Math.max(0, Math.min(conversations.length - 1, next))];
      if (!c) return;
      setSelectedKey(c.key);
      headerRefs.current.get(c.key)?.focus();
    };
    const current = conversations[index];
    const plain = !event.ctrlKey && !event.metaKey && !event.altKey;
    const action = (label: string) => (current ? actionsOf(current).find((a) => a.label === label) : undefined);
    const lower = event.key.toLowerCase();
    if ((event.ctrlKey || event.metaKey) && lower === "z" && data.deleted) {
      event.preventDefault();
      event.stopPropagation();
      data.undoDelete.mutate();
      return;
    }
    if (event.key === "Enter" && event.shiftKey) {
      // Shift+Enter: run the agent now on the open notes, without a new request.
      event.preventDefault();
      event.stopPropagation();
      if (runTarget && !data.readOnly) data.runNow.mutate(runTarget);
      return;
    }
    const keyed =
      event.key === "Enter" && current && event.target === headerRefs.current.get(current.key)
        ? action("Show in result")
        : plain && lower === "l"
          ? action("Re-attach")
          : plain && lower === "x"
            ? (action("Resolve") ?? action("Reopen"))
            : event.key === "Delete"
              ? action("Delete")
              : undefined;
    if (keyed) {
      event.preventDefault();
      event.stopPropagation();
      keyed.run();
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      event.stopPropagation();
      move(index + (event.key === "ArrowDown" ? 1 : -1));
    } else if ((event.key === "ArrowRight" || event.key === "ArrowLeft") && current) {
      event.preventDefault();
      event.stopPropagation();
      toggle(current, event.key === "ArrowRight");
    } else if ((event.key === "m" || event.key === "M") && !event.ctrlKey && !event.metaKey && !event.altKey) {
      // M: a new request, as M focuses the comment box elsewhere.
      event.preventDefault();
      event.stopPropagation();
      setReplyKey(null);
      requestComposerFocus();
    } else if (event.key === "?") {
      event.preventDefault();
      event.stopPropagation();
      setHelp((open) => !open);
    } else if (plain && lower === "p" && (subject || pinned)) {
      // P: pin the subject (or follow the selection again).
      event.preventDefault();
      event.stopPropagation();
      togglePin();
    } else if ((event.key === "r" || event.key === "R") && current && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      event.stopPropagation();
      setReplyKey(current.key);
      toggle(current, true);
      requestComposerFocus();
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
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
      {docked ? null : (
        <div className="flex shrink-0 items-center gap-1.5 border-b border-border px-2 py-1">
          <Bot className="h-4 w-4" aria-hidden="true" />
          <span className="text-sm font-semibold">Agent</span>
          <span className="text-[11px] text-muted-foreground">Ctrl+J</span>
          <span className="flex-1" />
          <button type="button" onClick={onClose} title="Close (Esc)" aria-label="Close the agent panel" className="rounded p-0.5 hover:bg-accent">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      <div
        ref={listRef}
        tabIndex={-1}
        aria-label="Agent conversations"
        data-pane-focus-target="true"
        className="min-h-0 flex-1 space-y-2 overflow-y-auto px-2 py-1 outline-none"
        onKeyDown={onListKeyDown}
      >
        {data.loading ? <LoadingState /> : null}
        {error ? <ErrorState message={error} /> : null}
        {conversations.map((c) => (
          <AgentConversation
            key={c.key}
            ref={(el) => {
              if (el) headerRefs.current.set(c.key, el);
              else headerRefs.current.delete(c.key);
            }}
            note={c.note}
            expanded={isExpanded(c)}
            selected={c.key === (selectedKey ?? conversations[0]?.key)}
            replying={c.key === replyKey}
            onToggle={() => toggle(c)}
            onFocus={() => setSelectedKey(c.key)}
            actions={actionsOf(c)}
          />
        ))}
        {data.deleted ? (
          <p className="text-[11px] text-muted-foreground">
            Deleted.{" "}
            <button type="button" onClick={() => data.undoDelete.mutate()} className="text-primary underline">
              Undo (Ctrl+Z)
            </button>
          </p>
        ) : null}
        {!data.loading && !conversations.length ? (
          <p className="py-2 text-muted-foreground">No conversations yet. Ask below; the agent replies here.</p>
        ) : null}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-0.5 border-t border-border px-2 py-0.5 text-[11px] text-muted-foreground">
        {help ? (
          <RowShortcutHints
            hints={[
              { keys: "↑↓", label: "move" },
              { keys: "→←", label: "fold" },
              { keys: "R", label: "reply" },
              { keys: "M", label: "ask" },
              { keys: "X", label: "resolve" },
              { keys: "⇧Enter", label: "run now" },
              { keys: "P", label: "pin" },
              { keys: "⇧Tab", label: "context (from the input)" },
              { keys: "Esc", label: "close" },
            ]}
          />
        ) : null}
        {starting ? <span>Starting…</span> : null}
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => setHelp((open) => !open)}
          aria-expanded={help}
          aria-label="Show keys and subject options"
          title="Keys and subject options (?)"
          className="rounded px-1 hover:bg-accent"
        >
          ?
        </button>
      </div>

      <div className="shrink-0 border-t border-border px-2 py-1.5">
        {drafts ? (
          <p className="mb-1 flex items-center gap-1 rounded bg-amber-100 px-2 py-0.5 text-[11px] text-amber-900 dark:bg-amber-950 dark:text-amber-200">
            <span className="flex-1">{drafts} {drafts === 1 ? "draft" : "drafts"} not sent</span>
            <button
              type="button"
              onClick={() => data.submitDrafts.mutate()}
              disabled={data.submitDrafts.isPending}
              title="Send the drafts of this item to the agent"
              className="rounded border border-amber-400 px-1.5 hover:bg-amber-200 dark:hover:bg-amber-900"
            >
              Send
            </button>
          </p>
        ) : null}
        {quote && !replyTo ? (
          <p className="mb-1 flex items-center gap-1 text-[11px] text-muted-foreground">
            Quoting
            <span className="min-w-0 flex-1 truncate border-l-2 border-yellow-400 pl-1 text-foreground" title={quote.quote}>
              {quote.quote}
            </span>
            <button type="button" onClick={onClearQuote} aria-label="Drop the quote" className="rounded hover:bg-accent">
              <X className="h-3 w-3" />
            </button>
          </p>
        ) : null}
        {replyTo ? (
          <p className="mb-1 flex items-center gap-1 text-[11px] text-muted-foreground">
            Replying to <span className="min-w-0 flex-1 truncate text-foreground">{replyTo.note.body.split("\n")[0]}</span>
            <button type="button" onClick={() => setReplyKey(null)} aria-label="Start a new request instead" className="rounded hover:bg-accent">
              <X className="h-3 w-3" />
            </button>
          </p>
        ) : null}
        {data.readOnly ? (
          <p className="mb-1 text-[11px] text-muted-foreground">Read-only validation mode: the request is saved but the agent is not started.</p>
        ) : null}
        <AgentContextChips
          subject={subject}
          offered={override && !override.subject ? live : null}
          pinned={!!override?.subject}
          list={liveList}
          listAttached={!!attachedList}
          onTogglePin={togglePin}
          onSubjectChange={(attach) => onOverrideChange(attach ? null : { subject: null })}
          onListAttachedChange={(attach) => onListAttachedChange(attach && liveList ? liveList.id : null)}
          onEscape={focusComposer}
        />
        <div ref={composerRef} data-agent-composer="true">
          <CommentComposer
            key={replyKey ?? "new"}
            placeholder={
              replyTo ? "Reply to the agent… (M)" : subject ? `Ask about ${subjectLabel(subject)}… (M)` : "Ask the agent… (M)"
            }
            submitLabel={replyTo ? "Reply" : "Ask"}
            busy={data.send.isPending}
            collapsible
            onCollapse={focusList}
            onSubmit={async (body) => {
              await data.send.mutateAsync({ body, replyTo, quote: replyTo ? null : quote });
              setReplyKey(null);
              if (!replyTo) onClearQuote();
            }}
          />
        </div>
      </div>
    </aside>
  );
}
