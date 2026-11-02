import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Bot, X } from "lucide-react";
import { commandErrorMessage, noteNeedsYou } from "@/lib/azdoCommands";
import { CommentComposer } from "@/features/pull-requests/CommentComposer";
import { ErrorState, LoadingState } from "@/components/StateDisplay";
import { RowShortcutHints } from "@/components/RowShortcutHints";
import { AgentConversation, lastActivity } from "./AgentConversation";
import { AgentContextChips } from "./AgentContextChips";
import { AgentPicker } from "./AgentPicker";
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
import { useAgentProposals } from "./useAgentProposals";

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
  // The agent and model picked for the next send; null follows Settings.
  const [choice, setChoice] = useState<AgentChoice>({ agent: null, model: null });
  const resetChoice = () => setChoice({ agent: null, model: null });
  const data = useAgentPanelData(subject, true, attachedList, choice);
  const { conversations } = data;
  const proposals = useAgentProposals(subject, conversations, { autoPost: data.autoPost, readOnly: data.readOnly });

  const [help, setHelp] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const headerRefs = useRef(new Map<string, HTMLButtonElement>());
  const replyRefs = useRef(new Map<string, HTMLDivElement>());
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

  // Focus after the render: replying swaps in a fresh composer. A panel that
  // was already open when it remounts (moved to another view) leaves the focus where it is.
  const [composerFocus, setComposerFocus] = useState(0);
  useEffect(() => {
    if (composerFocus) focusComposer();
  }, [composerFocus]);
  const requestComposerFocus = () => setComposerFocus((n) => n + 1);
  useEffect(() => {
    if (consumeAgentFocusRequest()) requestComposerFocus();
  }, []);

  // A conversation's own reply box: unfold the conversation, then focus the box
  // once it is rendered (it unfolds from its one-line button on focus).
  const [replyFocus, setReplyFocus] = useState<{ key: string; n: number }>({ key: "", n: 0 });
  function requestReplyFocus(key: string): void {
    setExpanded((prev) => ({ ...prev, [key]: true }));
    setSelectedKey(key);
    setReplyFocus((prev) => ({ key, n: prev.n + 1 }));
  }
  useEffect(() => {
    if (!replyFocus.n) return;
    const box = replyRefs.current.get(replyFocus.key);
    const textarea = box?.querySelector("textarea");
    if (textarea) textarea.focus();
    else box?.querySelector("button")?.click();
  }, [replyFocus]);

  // Opened on a request (e.g. from the Inbox): show it and answer it.
  useEffect(() => {
    if (focusAskId === null) return;
    const match = conversations.find((c) => c.section === "ask" && c.item.itemId === focusAskId);
    if (!match) return;
    setSelectedKey(match.key);
    toggle(match, true);
    if (noteNeedsYou(match.note)) requestReplyFocus(match.key);
  }, [focusAskId, conversations.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // A quote from the Result panel starts a note about it.
  useEffect(() => {
    if (!quote) return;
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
      ...(c.note.status !== "done" ? [{ label: "Delete", keys: "Del", run: () => deleteConversation(c) }] : []),
      ...(c.section === "item" && pendingProposals(c.note)[0]
        ? [{ label: "Post comment", keys: "C", run: () => proposals.post(c, pendingProposals(c.note)[0].index) }]
        : []),
    ];
  }

  // After a delete, focus moves to the neighbouring header (or the composer
  // when none is left) once the deleted conversation has left the list.
  const afterDelete = useRef<{ gone: string; next: string | null } | null>(null);
  useEffect(() => {
    const pending = afterDelete.current;
    if (!pending || conversations.some((c) => c.key === pending.gone)) return;
    afterDelete.current = null;
    const target = pending.next ?? conversations[0]?.key ?? null;
    if (target) {
      setSelectedKey(target);
      headerRefs.current.get(target)?.focus();
    } else {
      focusComposer();
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

  // Answer the waiting conversation once it has loaded.
  const handledReply = useRef(0);
  useEffect(() => {
    if (!replyRequest || handledReply.current === replyRequest) return;
    const target = selected ?? conversations.find((c) => noteNeedsYou(c.note)) ?? null;
    if (!target) return;
    handledReply.current = replyRequest;
    requestReplyFocus(target.key);
  }, [replyRequest, conversations.length]); // eslint-disable-line react-hooks/exhaustive-deps

  function onListKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void {
    // Keys typed into a conversation's reply box belong to the box.
    if (event.target instanceof HTMLElement && event.target.closest("textarea, input, [contenteditable='true']")) return;
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
          : plain && lower === "c"
            ? action("Post comment")
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
      requestReplyFocus(current.key);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      // The collapsed reply button: back to its conversation header.
      const ownHeader =
        event.target instanceof HTMLElement && event.target.closest("[data-agent-reply]")
          ? event.target.closest("[data-agent-conversation]")?.querySelector<HTMLElement>(":scope > button")
          : null;
      if (ownHeader) {
        ownHeader.focus();
        return;
      }
      onClose();
      // Closing hands focus back to where the panel was opened from. When that
      // place is gone (or was <body>), land on the view's grid, not <body>.
      window.setTimeout(() => {
        const active = document.activeElement;
        if (!active || active === document.body) focusPrimaryGrid();
      }, 0);
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
          <span className="text-2xs text-muted-foreground">Ctrl+J</span>
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
            onToggle={() => toggle(c)}
            onFocus={() => setSelectedKey(c.key)}
            actions={actionsOf(c)}
            replyRef={(el) => {
              if (el) replyRefs.current.set(c.key, el);
              else replyRefs.current.delete(c.key);
            }}
            replyBusy={data.send.isPending && data.send.variables?.replyTo?.key === c.key}
            onReply={async (body) => {
              await data.send.mutateAsync({ body, replyTo: c, quote: null });
              resetChoice();
            }}
            onReplyCollapse={() => headerRefs.current.get(c.key)?.focus()}
            onPostProposal={c.section === "item" ? (replyIndex) => proposals.post(c, replyIndex) : null}
            {...proposals.viewProps(c)}
            autoPost={data.autoPost}
          />
        ))}
        {data.deleted ? (
          <p className="text-2xs text-muted-foreground">
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
      {help || starting ? (
        <div className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-0.5 border-t border-border px-2 py-0.5 text-2xs text-muted-foreground">
          {help ? (
            <RowShortcutHints
              hints={[
                { keys: "↑↓", label: "move" },
                { keys: "→←", label: "fold" },
                { keys: "R", label: "reply" },
                { keys: "M", label: "ask" },
                { keys: "X", label: "resolve" },
                { keys: "C", label: "post comment" },
                { keys: "⇧Enter", label: "run now" },
                { keys: "P", label: "pin" },
                { keys: "⇧Tab", label: "agent / context (from the input)" },
                { keys: "Esc", label: "close" },
              ]}
            />
          ) : null}
          {starting ? <span>Starting…</span> : null}
        </div>
      ) : null}

      {/* The keys toggle sits in the composer's corner instead of taking a row of its own. */}
      <div className="relative shrink-0 border-t border-border py-1.5 pl-2 pr-6">
        <button
          type="button"
          onClick={() => setHelp((open) => !open)}
          aria-expanded={help}
          aria-label="Show keys and subject options"
          title="Keys and subject options (?)"
          className="absolute right-1 top-1 rounded px-1 text-2xs text-muted-foreground hover:bg-accent"
        >
          ?
        </button>
        {drafts ? (
          <p className="mb-1 flex items-center gap-1 rounded bg-warning/10 px-2 py-0.5 text-2xs text-warning">
            <span className="flex-1">{drafts} {drafts === 1 ? "draft" : "drafts"} not sent</span>
            <button
              type="button"
              onClick={() => data.submitDrafts.mutate()}
              disabled={data.submitDrafts.isPending}
              title="Send the drafts of this item to the agent"
              className="rounded border border-warning/40 px-1.5 hover:bg-warning/20"
            >
              Send
            </button>
          </p>
        ) : null}
        {quote ? (
          <p className="mb-1 flex items-center gap-1 text-2xs text-muted-foreground">
            Quoting
            <span className="min-w-0 flex-1 truncate border-l-2 border-warning pl-1 text-foreground" title={quote.quote}>
              {quote.quote}
            </span>
            <button type="button" onClick={onClearQuote} aria-label="Drop the quote" className="rounded hover:bg-accent">
              <X className="h-3 w-3" />
            </button>
          </p>
        ) : null}
        {data.readOnly ? (
          <p className="mb-1 text-2xs text-muted-foreground">Read-only validation mode: the request is saved but the agent is not started.</p>
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
        {data.readOnly ? null : (
          <AgentPicker
            value={data.agent}
            defaultAgent={data.defaultAgent}
            onChange={(agent) => setChoice({ agent, model: null })}
            model={data.model}
            models={data.modelChoices}
            onModelChange={(model) => setChoice((prev) => ({ ...prev, model }))}
            onEscape={focusComposer}
          />
        )}
        <div ref={composerRef} data-agent-composer="true">
          <CommentComposer
            placeholder={subject ? `Ask about ${subjectLabel(subject)}… (M)` : "Ask the agent… (M)"}
            submitLabel="Ask"
            busy={data.send.isPending && !data.send.variables?.replyTo}
            collapsible
            onCollapse={focusList}
            onSubmit={async (body) => {
              await data.send.mutateAsync({ body, replyTo: null, quote });
              onClearQuote();
              resetChoice();
            }}
          />
        </div>
      </div>
    </aside>
  );
}
