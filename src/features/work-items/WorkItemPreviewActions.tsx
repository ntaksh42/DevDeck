import { Copy, Share2 } from 'lucide-react';
import type { WorkItemPreview } from '@/lib/azdoCommands';
import { openMailtoUrl } from '@/lib/openExternal';
import { buildWorkItemEmailLink } from './workItemChanges';

const buttonClass =
  "inline-flex h-5 w-5 items-center justify-center rounded border border-border bg-card text-muted-foreground hover:bg-secondary hover:text-foreground";

// Small header-row action buttons for the work item preview panel: "Email a
// link" (mirrors Azure DevOps Web's own share action) and "Duplicate". Split
// out from WorkItemPreviewPanel.tsx to keep that file under the 500-line limit.
export function WorkItemPreviewActions({
  preview,
  onDuplicate,
}: {
  preview: WorkItemPreview;
  onDuplicate: (() => void) | null;
}) {
  function emailLink() {
    void openMailtoUrl(buildWorkItemEmailLink(preview));
  }

  return (
    <>
      <button
        type="button"
        aria-label="Email a link"
        title="Email a link"
        onClick={emailLink}
        className={buttonClass}
      >
        <Share2 className="h-3 w-3" aria-hidden="true" />
      </button>
      {onDuplicate ? (
        <button
          type="button"
          aria-label="Duplicate work item"
          title="Duplicate into a new item (D)"
          onClick={onDuplicate}
          className={buttonClass}
        >
          <Copy className="h-3 w-3" aria-hidden="true" />
        </button>
      ) : null}
    </>
  );
}
