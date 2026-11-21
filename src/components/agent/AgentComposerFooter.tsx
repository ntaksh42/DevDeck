import type { ReactNode } from "react";
import { X } from "lucide-react";
import { CommentComposer } from "@/features/pull-requests/CommentComposer";
import type { AgentQuote } from "./agentSubject";

/**
 * The panel's single input and what sits on it: the drafts banner, the quoted
 * result text, the read-only note, the context chips and the agent picker
 * (passed in), and the `?` keys toggle in its corner. On the list it asks
 * something new; in a conversation it replies there.
 */
export function AgentComposerFooter({
  composerKey,
  placeholder,
  submitLabel,
  busy,
  onSubmit,
  onCollapse,
  help,
  onToggleHelp,
  drafts,
  onSendDrafts,
  sendingDrafts,
  quote,
  onClearQuote,
  readOnly,
  chips,
  picker,
}: {
  /** Changes when the input starts over (another conversation), so a draft does not carry across. */
  composerKey: string;
  placeholder: string;
  submitLabel: string;
  busy: boolean;
  onSubmit: (body: string) => Promise<void>;
  onCollapse: () => void;
  help: boolean;
  onToggleHelp: () => void;
  drafts: number;
  onSendDrafts: () => void;
  sendingDrafts: boolean;
  quote: AgentQuote | null;
  onClearQuote: () => void;
  readOnly: boolean;
  chips: ReactNode;
  picker: ReactNode;
}) {
  return (
    <div className="relative shrink-0 border-t border-border py-1.5 pl-2 pr-6">
      <button
        type="button"
        onClick={onToggleHelp}
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
            onClick={onSendDrafts}
            disabled={sendingDrafts}
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
      {readOnly ? (
        <p className="mb-1 text-2xs text-muted-foreground">Read-only validation mode: the request is saved but the agent is not started.</p>
      ) : null}
      {chips}
      {picker}
      <div data-agent-composer="true">
        <CommentComposer
          key={composerKey}
          placeholder={placeholder}
          submitLabel={submitLabel}
          busy={busy}
          collapsible
          onCollapse={onCollapse}
          onSubmit={onSubmit}
        />
      </div>
    </div>
  );
}
