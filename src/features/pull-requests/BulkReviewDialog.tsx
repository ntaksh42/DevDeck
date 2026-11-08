import { useEffect, useRef, useState } from 'react';
import { useFocusTrap } from '@/lib/useFocusTrap';

/**
 * Asks to confirm a review request and lets the requester say what the agent
 * should look at first. Opens on the note field; Ctrl+Enter confirms, Escape
 * cancels, and focus returns to the grid row that opened it.
 */
export function BulkReviewDialog({
  titles,
  onConfirm,
  onCancel,
}: {
  titles: string[];
  onConfirm: (focus: string) => void;
  onCancel: () => void;
}) {
  const [focus, setFocus] = useState('');
  const dialogRef = useRef<HTMLDivElement>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  useFocusTrap(dialogRef, { restoreFocus: true });
  useEffect(() => noteRef.current?.focus(), []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      // Focus that strayed outside (e.g. onto <body>) must not drive the app
      // behind the dialog; pull it back in instead.
      if (!dialogRef.current?.contains(event.target as Node)) {
        event.preventDefault();
        event.stopPropagation();
        if (event.key === 'Escape') onCancel();
        else noteRef.current?.focus();
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onCancel();
      } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        event.stopPropagation();
        onConfirm(focus);
      }
    }
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [focus, onCancel, onConfirm]);

  const heading = `Request a review of ${titles.length} PR${titles.length === 1 ? '' : 's'}?`;
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4"
      // A click on the backdrop does nothing, and must not pull focus off the field.
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) event.preventDefault();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={heading}
        // The dialog is rendered inside the grid's React tree: without this the
        // grid's own shortcuts (vote, snooze, ...) and the app's global ones
        // would react to keys typed here.
        onKeyDown={(event) => event.stopPropagation()}
        className="w-full max-w-md rounded-md border border-border bg-card p-4 shadow-lg"
      >
        <h2 className="text-base font-semibold text-foreground">{heading}</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The agent reviews them one at a time and uses its model for each. A PR with no new push since its last review is skipped.
        </p>
        <ul className="mt-2 max-h-32 overflow-y-auto text-sm text-foreground">
          {titles.slice(0, 8).map((title) => (
            <li key={title} className="truncate">{title}</li>
          ))}
          {titles.length > 8 ? <li className="text-muted-foreground">…and {titles.length - 8} more</li> : null}
        </ul>
        <label className="mt-3 block text-xs font-medium text-muted-foreground" htmlFor="bulk-review-focus">
          Points to check (optional, applies to every PR above)
        </label>
        <textarea
          id="bulk-review-focus"
          ref={noteRef}
          value={focus}
          onChange={(event) => setFocus(event.target.value)}
          rows={4}
          maxLength={2000}
          placeholder="e.g. Is the error handling safe? Any change that breaks existing callers?"
          className="mt-1 w-full resize-y rounded-md border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <div className="mt-4 flex items-center justify-end gap-2">
          <span className="mr-auto text-2xs text-muted-foreground">Ctrl+Enter to request · Esc to cancel</span>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-border bg-card px-3 py-1.5 text-sm font-medium hover:bg-secondary focus:outline-none focus:ring-2 focus:ring-ring"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm(focus)}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-ring"
          >
            Request review
          </button>
        </div>
      </div>
    </div>
  );
}
