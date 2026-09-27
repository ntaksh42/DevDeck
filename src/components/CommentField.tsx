import type { ReactNode, Ref, TextareaHTMLAttributes } from "react";
import { Loader2 } from "lucide-react";

export const commentSecondaryButtonClass =
  "rounded border border-border bg-card px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-secondary hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50";

/**
 * The one comment input look shared by PR comments/replies/edits, work item
 * comments/edits and agent notes: a bordered textarea (with an optional
 * overlay such as a mention picker) above a single action row — shortcut hint
 * on the left, then status, extra actions, Cancel and the primary submit.
 * Callers keep their own draft, key handling and mention logic.
 */
export function CommentField({
  textareaRef,
  containerRef,
  overlay,
  hint = "Ctrl+Enter to post · Esc to cancel",
  submitLabel,
  submitAriaLabel,
  submitDisabled = false,
  pending = false,
  onSubmit,
  onCancel,
  cancelDisabled = false,
  extraActions,
  status,
  error,
  showActions = true,
  className = "",
  ...textareaProps
}: TextareaHTMLAttributes<HTMLTextAreaElement> & {
  textareaRef?: Ref<HTMLTextAreaElement>;
  /** Ref for the `relative` wrapper around the textarea and overlay. */
  containerRef?: Ref<HTMLDivElement>;
  overlay?: ReactNode;
  hint?: string;
  submitLabel: string;
  submitAriaLabel?: string;
  submitDisabled?: boolean;
  pending?: boolean;
  onSubmit: () => void;
  onCancel?: () => void;
  cancelDisabled?: boolean;
  extraActions?: ReactNode;
  status?: ReactNode;
  error?: ReactNode;
  showActions?: boolean;
}) {
  return (
    <div className="grid gap-1">
      <div ref={containerRef} className="relative">
        <textarea
          ref={textareaRef}
          {...textareaProps}
          className={`w-full resize-y rounded border border-input bg-background px-2 py-1 text-xs outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring disabled:opacity-50 ${className}`}
        />
        {overlay}
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      {showActions ? (
        <div className="flex items-center gap-1.5">
          <span className="mr-auto text-[11px] text-muted-foreground">{hint}</span>
          {status}
          {extraActions}
          {onCancel ? (
            <button
              type="button"
              onClick={onCancel}
              disabled={cancelDisabled}
              className={commentSecondaryButtonClass}
            >
              Cancel
            </button>
          ) : null}
          <button
            type="button"
            onClick={onSubmit}
            disabled={submitDisabled || pending}
            aria-label={submitAriaLabel}
            className="inline-flex items-center gap-1 rounded bg-primary px-2 py-0.5 text-[11px] font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> : null}
            {submitLabel}
          </button>
        </div>
      ) : null}
    </div>
  );
}
