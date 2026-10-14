import type { InboxInsight } from "@/lib/azdoCommands";
import { Kbd } from "./InboxPreviewPanels";

const VERDICTS: Record<string, { label: string; className: string }> = {
  reply: { label: "Reply", className: "border-sky-600/40 text-sky-700 dark:text-sky-300" },
  fix: { label: "Fix first", className: "border-amber-600/40 text-amber-700 dark:text-amber-300" },
  none: { label: "No action", className: "border-border text-muted-foreground" },
};

/**
 * Claude Code's notes for deciding on the item (Settings → Inbox summaries):
 * a verdict with its reason, the evidence behind it, and a reply draft that
 * Shift+R puts in the reply box. Always the same frame, also while it is being
 * written or when it failed, so it is found in the same place on every item.
 */
export function InboxInsightPanel({
  insight,
  onUseDraft,
}: {
  insight: InboxInsight | null;
  /** Unset in read-only validation mode, where nothing can be posted. */
  onUseDraft?: (text: string) => void;
}) {
  if (!insight) return null;
  const verdict = insight.verdict ? VERDICTS[insight.verdict] : undefined;
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
              <span className={`shrink-0 rounded border px-1 text-[11px] font-semibold ${verdict.className}`}>
                {verdict.label}
              </span>
            ) : null}
            <span className="min-w-0 break-words">{insight.reason}</span>
          </>
        )}
      </div>

      {insight.evidence.length > 0 ? (
        <ul className="mt-1 space-y-1">
          {insight.evidence.map((evidence, index) => (
            <li key={index} className="min-w-0">
              <div className="flex flex-wrap items-baseline gap-x-1.5">
                {evidence.location ? (
                  <span className="font-mono text-[11px] text-muted-foreground">{evidence.location}</span>
                ) : null}
                <span className="break-words">{evidence.text}</span>
                {evidence.guess ? (
                  <span className="rounded border border-border px-1 text-[10px] text-muted-foreground">
                    unverified
                  </span>
                ) : null}
              </div>
              {evidence.code ? (
                <pre className="mt-0.5 overflow-x-auto rounded bg-background px-1.5 py-0.5 font-mono text-[11px] leading-snug">
                  {evidence.code}
                </pre>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {insight.replyDraft ? (
        <div className="mt-1.5 border-t border-dashed border-border pt-1">
          <p className="whitespace-pre-line break-words">{insight.replyDraft}</p>
          {onUseDraft ? (
            <button
              type="button"
              onClick={() => onUseDraft(insight.replyDraft ?? "")}
              className="mt-1 inline-flex items-center gap-1 rounded border border-border bg-background px-1.5 py-0.5 text-[11px] hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring"
            >
              Use as reply <Kbd>Shift+R</Kbd>
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
