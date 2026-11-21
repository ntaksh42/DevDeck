import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ArrowUp, X } from "lucide-react";
import type { AgentKind } from "@/lib/azdoCommands";

const AGENTS: { kind: AgentKind; label: string }[] = [
  { kind: "claude", label: "Claude" },
  { kind: "codex", label: "Codex" },
];
const MAX_HEIGHT = 200;

export type ComposerDraft = { key: number; text: string; targetLabel: string | null };

/**
 * The chat input as chat apps have it: one rounded box that is always open,
 * grows with its text, Enter sends and Shift+Enter breaks the line. The
 * subject chip sits on top; the agent, the model and the send button at the
 * bottom. Esc leaves the box (the text stays).
 */
export function HomeChatComposer({
  draft,
  busy,
  agent,
  defaultAgent,
  onAgentChange,
  model,
  models,
  onModelChange,
  onClearTarget,
  onSend,
  onLeave,
}: {
  draft: ComposerDraft;
  busy: boolean;
  agent: AgentKind;
  defaultAgent: AgentKind;
  onAgentChange: (next: AgentKind) => void;
  model: string;
  models: string[];
  onModelChange: (next: string) => void;
  onClearTarget: () => void;
  onSend: (text: string) => Promise<void>;
  onLeave: () => void;
}) {
  const [text, setText] = useState(draft.text);
  const [sending, setSending] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const agentRefs = useRef(new Map<AgentKind, HTMLButtonElement>());

  // A new draft (Start on a suggestion, or after sending) replaces the text.
  useEffect(() => {
    setText(draft.text);
    if (draft.text) {
      window.requestAnimationFrame(() => {
        const box = textareaRef.current;
        box?.focus();
        box?.setSelectionRange(box.value.length, box.value.length);
      });
    }
  }, [draft.key, draft.text]);

  useEffect(() => {
    const box = textareaRef.current;
    if (!box) return;
    box.style.height = "auto";
    box.style.height = `${Math.min(box.scrollHeight, MAX_HEIGHT)}px`;
  }, [text]);

  const disabled = busy || sending;
  const canSend = !disabled && text.trim() !== "";

  async function send() {
    if (!canSend) return;
    setSending(true);
    try {
      await onSend(text.trim());
      setText("");
    } finally {
      setSending(false);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      event.stopPropagation();
      void send();
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onLeave();
    }
  }

  function onAgentKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.stopPropagation();
      textareaRef.current?.focus();
      return;
    }
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    event.stopPropagation();
    const index = AGENTS.findIndex((a) => a.kind === agent);
    const next = AGENTS[(index + 1) % AGENTS.length].kind;
    onAgentChange(next);
    agentRefs.current.get(next)?.focus();
  }

  return (
    <div className="shrink-0 px-3 pb-3 pt-1">
      <div
        data-home-composer="true"
        className="rounded-xl border border-input bg-background shadow-sm transition-colors focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20"
      >
        {draft.targetLabel ? (
          <div className="flex px-3 pt-2">
            <span className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2 text-xs text-primary">
              About {draft.targetLabel}
              <button
                type="button"
                onClick={onClearTarget}
                aria-label={`Remove ${draft.targetLabel}`}
                className="rounded-full hover:bg-primary/20"
              >
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
            </span>
          </div>
        ) : null}
        <textarea
          ref={textareaRef}
          value={text}
          rows={1}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={busy ? "The Orchestrator is replying…" : "Message the Orchestrator…"}
          aria-label="Message the Orchestrator"
          className="block max-h-[200px] w-full resize-none bg-transparent px-3 pb-1 pt-2.5 text-sm leading-6 outline-none placeholder:text-muted-foreground"
        />
        <div className="flex items-center gap-2 px-2 pb-2">
          <div role="radiogroup" aria-label="Agent" className="flex rounded-lg bg-muted p-0.5" onKeyDown={onAgentKeyDown}>
            {AGENTS.map(({ kind, label }) => {
              const checked = kind === agent;
              return (
                <button
                  key={kind}
                  ref={(element) => {
                    if (element) agentRefs.current.set(kind, element);
                    else agentRefs.current.delete(kind);
                  }}
                  type="button"
                  role="radio"
                  aria-checked={checked}
                  tabIndex={checked ? 0 : -1}
                  title={kind === defaultAgent ? `${label} (Home Bot default)` : label}
                  onClick={() => onAgentChange(kind)}
                  className={`rounded-md px-2.5 py-0.5 text-xs font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                    checked ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <select
            aria-label="Model"
            value={model}
            onChange={(event) => onModelChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.stopPropagation();
                textareaRef.current?.focus();
              }
            }}
            className="h-7 rounded-md border-0 bg-transparent px-1 text-xs text-muted-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="">Default model</option>
            {models.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => void send()}
            disabled={!canSend}
            aria-label="Send"
            title="Send (Enter)"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-35 ml-auto"
          >
            <ArrowUp className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}
