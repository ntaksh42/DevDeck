import { useState } from "react";
import type { InboxInsight } from "@/lib/azdoCommands";
import { Kbd } from "./InboxPreviewPanels";

/** `rowClassName` is the small pill on the list row. */
export const VERDICTS: Record<string, { label: string; className: string; rowClassName: string }> = {
  reply: { label: "Reply", rowClassName: "border-violet-600/40 bg-violet-500/10 text-violet-700 dark:text-violet-300", className: "border-info/40 text-info" },
  fix: { label: "Fix first", rowClassName: "border-destructive/40 bg-destructive/10 text-destructive", className: "border-warning/40 text-warning" },
  none: { label: "No action", rowClassName: "border-border text-muted-foreground", className: "border-border text-muted-foreground" },
};

/**
 * Claude Code's notes for deciding on the item (Settings → Inbox summaries):
 * a verdict with its reason, the evidence behind it, and a reply draft that
 * Shift+R puts in the reply box. Always the same frame, also while it is being
 * written or when it failed, so it is found in the same place on every item.
 */
export function InboxInsightPanel({
  itemId,
  insight,
  onUseDraft,
  onGenerate,
}: {
  /** Folding is per item: a different item starts folded again. */
  itemId: number;
  insight: InboxInsight | null;
  onUseDraft: (text: string) => void;
  /** Set when notes can be written on request (summaries on, open comment item). */
  onGenerate?: () => void;
}) {
  // Folded by default: the verdict, its reason and the reply button are enough to decide; evidence and the draft's text open on demand.
  const [expandedFor, setExpandedFor] = useState<number | null>(null);
  const expanded = expandedFor === itemId;
  const generateButton = onGenerate ? (
    <button
      type="button"
      onClick={onGenerate}
      className="ml-auto shrink-0 inline-flex items-center gap-1 rounded border border-border bg-card px-1.5 py-0.5 text-2xs hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring"
    >
      {insight ? "Regenerate" : "Generate notes"} <Kbd>I</Kbd>
    </button>
  ) : null;
  if (!insight) {
    return generateButton ? (
      <section
        aria-label="Notes by Claude"
        className="mt-1.5 flex items-center gap-2 rounded border border-border bg-muted/40 px-2 py-1.5 text-xs"
      >
        <span className="font-semibold text-muted-foreground">Claude</span>
        <span className="text-muted-foreground">No notes yet.</span>
        {generateButton}
      </section>
    ) : null;
  }
  const verdict = insight.verdict ? VERDICTS[insight.verdict] : undefined;
  const hasDetails = insight.status === "ready" && (insight.evidence.length > 0 || !!insight.replyDraft);
  const detailsLabel = insight.evidence.length > 0 ? `Evidence (${insight.evidence.length})` : "Suggested reply";
  return (
    <section
      aria-label="Notes by Claude"
      className="mt-1.5 rounded border border-border bg-muted/40 px-2 py-1.5 text-xs"
    >
      <div className="flex items-start gap-2">
        <span className="shrink-0 font-semibold text-muted-foreground">Claude</span>
        {insight.status === "pending" ? (
          <span className="text-muted-foreground">Looking into this item…</span>
        ) : insight.status === "failed" ? (
          <span className="text-muted-foreground">
            Could not write notes: {insight.error ?? "Claude Code did not answer."}
          </span>
        ) : (
          <>
            {verdict ? (
              <span className={`shrink-0 rounded border px-1 text-2xs font-semibold ${verdict.className}`}>
                {verdict.label}
              </span>
            ) : null}
            <span className="min-w-0 break-words">{insight.reason}</span>
          </>
        )}
        {insight.status === "pending" ? null : generateButton}
      </div>

      {hasDetails ? (
        <div className="mt-1 flex items-center gap-2">
          <button
            type="button"
            aria-expanded={expanded}
            onClick={() => setExpandedFor(expanded ? null : itemId)}
            className="rounded px-1 text-2xs text-link hover:underline focus:outline-none focus:ring-1 focus:ring-ring"
          >
            {expanded ? "▾" : "▸"} {detailsLabel}
          </button>
          {insight.replyDraft ? (
            <button
              type="button"
              onClick={() => onUseDraft(insight.replyDraft ?? "")}
              className="inline-flex items-center gap-1 rounded border border-border bg-card px-1.5 py-0.5 text-2xs hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring"
            >
              Use as reply <Kbd>Shift+R</Kbd>
            </button>
          ) : null}
        </div>
      ) : null}

      {expanded && insight.evidence.length > 0 ? (
        <ul className="mt-1 space-y-1">
          {insight.evidence.map((evidence, index) => (
            <li key={index} className="min-w-0">
              <div className="flex flex-wrap items-baseline gap-x-1.5">
                {evidence.location ? (
                  <span className="font-mono text-2xs text-muted-foreground">{evidence.location}</span>
                ) : null}
                <span className="break-words">{evidence.text}</span>
                {evidence.guess ? (
                  <span className="rounded border border-border px-1 text-3xs text-muted-foreground">
                    unverified
                  </span>
                ) : null}
              </div>
              {evidence.code ? (
                <pre className="mt-0.5 overflow-x-auto rounded bg-background px-1.5 py-0.5 font-mono text-2xs leading-snug">
                  {evidence.code}
                </pre>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {expanded && insight.replyDraft ? (
        <div className="mt-1.5 rounded border-l-2 border-l-info bg-background px-2 py-1">
          <p className="text-3xs font-semibold uppercase tracking-wide text-muted-foreground">Suggested reply</p>
          <p className="mt-0.5 whitespace-pre-line break-words">{insight.replyDraft}</p>
        </div>
      ) : null}
    </section>
  );
}
