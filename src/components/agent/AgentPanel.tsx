import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Bot, ChevronsDownUp, ChevronsUpDown, Pin, PinOff, Play, X } from "lucide-react";
import { commandErrorMessage, noteNeedsYou, type AgentNoteKind } from "@/lib/azdoCommands";
import { CommentComposer } from "@/features/pull-requests/CommentComposer";
import { ErrorState, LoadingState } from "@/components/StateDisplay";
import { RowShortcutHints } from "@/components/RowShortcutHints";
import { AgentConversation, lastActivity } from "./AgentConversation";
import {
  noteItemOf,
  requestNoteReattach,
  requestNoteReveal,
  subjectKey,
  subjectLabel,
  useAgentSubject,
  type AgentQuote,
} from "./agentSubject";
import { focusAgentComposer, type SubjectOverride } from "./agentPanelStore";
import { useAgentPanelData, type Conversation } from "./useAgentPanelData";

const KINDS: { kind: AgentNoteKind; label: string; hint: string }[] = [
  { kind: "investigate", label: "Investigate", hint: "Look into it and report the cause or conclusion" },
  { kind: "summarize", label: "Summarize", hint: "Summarize it in a reply" },
  { kind: "question", label: "Question", hint: "Answer a question" },
];

/** Offered while the new note quotes the result: point at text to fix. */
const FIX_KIND = { kind: "fix" as const, label: "Fix", hint: "Fix the quoted part of the result" };

/**
 * The app-wide Agent panel (Ctrl+J): asks the external agent to investigate,
 * summarize or answer something about the item selected in any view, or about
 * nothing in particular. Each conversation folds to one line.
 */
export function AgentPanel({
  docked = false,
  override,
  onOverrideChange,
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
  const data = useAgentPanelData(subject, true);
  const { conversations } = data;

  const [kind, setKind] = useState<AgentNoteKind>("investigate");
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
  const allExpanded = conversations.length > 0 && conversations.every(isExpanded);

  const selected = conversations.find((c) => c.key === selectedKey) ?? null;
  const replyTo = conversations.find((c) => c.key === replyKey) ?? null;

  const focusComposer = focusAgentComposer;
  function focusList(): void {
    const key = selectedKey ?? conversations[0]?.key;
    const header = key ? headerRefs.current.get(key) : undefined;
    if (header) header.focus();
    else listRef.current?.focus();
  }

  // Focus after the render: replying swaps in a fresh composer.
  const [composerFocus, setComposerFocus] = useState(1);
  useEffect(() => {
    if (composerFocus) focusComposer();
  }, [composerFocus]);
  const requestComposerFocus = () => setComposerFocus((n) => n + 1);

  // Opened on a request (e.g. from the Inbox): show it and answer it.
  useEffect(() => {
    if (focusAskId === null) return;
    const match = conversations.find((c) => c.section === "ask" && c.item.itemId === focusAskId);
    if (!match) return;
    setSelectedKey(match.key);
    toggle(match, true);
    if (noteNeedsYou(match.note)) setReplyKey(match.key);
  }, [focusAskId, conversations.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // A quote from the Result panel starts a "fix" note about it.
  useEffect(() => {
    if (!quote) return;
    setReplyKey(null);
    setKind("fix");
    requestComposerFocus();
  }, [quote]);
  useEffect(() => {
    if (!quote && kind === "fix") setKind("investigate");
  }, [quote]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const sections: { id: Conversation["section"]; title: string }[] = [
    { id: "item", title: subject && (subject.kind === "pull-request" || subject.kind === "work-item") ? "This item" : "" },
    { id: "ask", title: "Requests" },
  ];
  const kinds = quote ? [FIX_KIND, ...KINDS] : KINDS;
  const drafts = conversations.filter((c) => c.section === "item" && c.note.status === "draft").length;
  const failure = data.error ?? data.send.error ?? data.runNow.error;
  const error = failure ? commandErrorMessage(failure) : null;
  // Run now: the selected conversation's notes, else the subject's.
  const runTarget = selected?.item ?? noteItemOf(subject);
  const pinned = override !== null;

  return (
    <aside
      aria-label="Agent"
      data-agent-panel="true"
      // min-h-0 / overflow-hidden: inside a dock panel the list scrolls, not the whole panel.
      className={`flex h-full min-h-0 flex-col overflow-hidden bg-card text-xs ${docked ? "w-full min-w-0" : "w-[360px] shrink-0 border-l border-border"}`}
      onKeyDown={(event) => {
        // Keep the panel's keys away from the grid underneath.
        if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Enter"].includes(event.key)) event.stopPropagation();
      }}
    >
      <div className="flex shrink-0 items-center gap-1.5 border-b border-border px-2 py-1">
        {/* Docked, the tab already names the panel. */}
        {docked ? null : (
          <>
            <Bot className="h-4 w-4" aria-hidden="true" />
            <span className="text-sm font-semibold">Agent</span>
            <span className="text-[11px] text-muted-foreground">Ctrl+J</span>
          </>
        )}
        {data.send.isPending || data.runNow.isPending ? (
          <span className="text-[11px] text-muted-foreground">Starting…</span>
        ) : null}
        <span className="flex-1" />
        {drafts ? (
          <button
            type="button"
            onClick={() => data.submitDrafts.mutate()}
            disabled={data.submitDrafts.isPending}
            title="Send the drafts of this item to the agent"
            className="rounded border border-border px-1.5 text-[11px] hover:bg-accent"
          >
            Send drafts ({drafts})
          </button>
        ) : null}
        {runTarget && !data.readOnly ? (
          <button
            type="button"
            onClick={() => data.runNow.mutate(runTarget)}
            disabled={data.runNow.isPending}
            title="Run the agent now on the open notes of the selected conversation or item"
            aria-label="Run the agent now"
            className="rounded p-0.5 hover:bg-accent"
          >
            <Play className="h-3.5 w-3.5" />
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => setExpanded(Object.fromEntries(conversations.map((c) => [c.key, !allExpanded])))}
          title={allExpanded ? "Collapse all conversations" : "Expand all conversations"}
          aria-label={allExpanded ? "Collapse all conversations" : "Expand all conversations"}
          className="rounded p-0.5 hover:bg-accent"
        >
          {allExpanded ? <ChevronsDownUp className="h-3.5 w-3.5" /> : <ChevronsUpDown className="h-3.5 w-3.5" />}
        </button>
        <button type="button" onClick={onClose} title="Close (Esc)" aria-label="Close the agent panel" className="rounded p-0.5 hover:bg-accent">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="flex shrink-0 items-center gap-1 border-b border-border px-2 py-1" data-agent-subject={subjectKey(subject)}>
        <span className="text-[11px] text-muted-foreground">About</span>
        {subject ? (
          <span className="flex min-w-0 items-center gap-1 rounded-full border border-primary/40 bg-primary/5 px-1.5">
            <span className="truncate" title={subjectLabel(subject)}>{subjectLabel(subject)}</span>
            <button
              type="button"
              onClick={() => onOverrideChange(pinned ? null : { subject })}
              title={pinned ? "Follow the selection again" : "Keep this subject while you move around"}
              aria-label={pinned ? "Unpin the subject" : "Pin the subject"}
              className="rounded hover:bg-accent"
            >
              {pinned ? <PinOff className="h-3 w-3" /> : <Pin className="h-3 w-3" />}
            </button>
            <button
              type="button"
              onClick={() => onOverrideChange({ subject: null })}
              title="Ask without a subject"
              aria-label="Remove the subject"
              className="rounded hover:bg-accent"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ) : (
          <span className="text-muted-foreground">
            nothing in particular
            {pinned ? (
              <button type="button" onClick={() => onOverrideChange(null)} className="ml-1 text-primary underline">
                follow selection
              </button>
            ) : null}
          </span>
        )}
      </div>

      <div
        ref={listRef}
        tabIndex={-1}
        aria-label="Agent conversations"
        className="min-h-0 shrink space-y-2 overflow-y-auto px-2 py-1 outline-none"
        onKeyDown={onListKeyDown}
      >
        {data.loading ? <LoadingState /> : null}
        {error ? <ErrorState message={error} /> : null}
        {sections.map(({ id, title }) => {
          const items = conversations.filter((c) => c.section === id);
          if (!items.length) return null;
          return (
            <div key={id} className="">
              {title ? <p className="pt-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</p> : null}
              {items.map((c) => (
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
            </div>
          );
        })}
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
      <div className="shrink-0 border-t border-border px-2 py-0.5">
        <RowShortcutHints
          hints={[
            { keys: "↑↓", label: "move" },
            { keys: "→←", label: "fold" },
            { keys: "R", label: "reply" },
            { keys: "M", label: "ask" },
            { keys: "Esc", label: "close" },
          ]}
        />
      </div>

      <div className="shrink-0 border-t border-border px-2 py-1.5">
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
        ) : (
          <div role="radiogroup" aria-label="Request kind" className="mb-1 inline-flex overflow-hidden rounded border border-border">
            {kinds.map((option) => (
              <button
                key={option.kind}
                type="button"
                role="radio"
                aria-checked={kind === option.kind}
                title={option.hint}
                onClick={() => setKind(option.kind)}
                className={`border-l border-border px-2 py-0.5 text-[11px] first:border-l-0 ${kind === option.kind ? "bg-secondary font-semibold text-foreground" : "text-muted-foreground hover:bg-accent"}`}
              >
                {option.label}
              </button>
            ))}
          </div>
        )}
        {data.readOnly ? (
          <p className="mb-1 text-[11px] text-muted-foreground">Read-only validation mode: the request is saved but the agent is not started.</p>
        ) : null}
        <div ref={composerRef} data-agent-composer="true">
          <CommentComposer
            key={replyKey ?? "new"}
            placeholder={replyTo ? "Reply to the agent… (M)" : "Ask the agent… (M)"}
            submitLabel={replyTo ? "Reply" : "Ask"}
            busy={data.send.isPending}
            collapsible
            onCollapse={focusList}
            onSubmit={async (body) => {
              await data.send.mutateAsync({ body, kind, replyTo, quote: replyTo ? null : quote });
              setReplyKey(null);
              if (!replyTo) onClearQuote();
            }}
          />
        </div>
      </div>
    </aside>
  );
}
