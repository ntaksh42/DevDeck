import { Keyboard, X } from "lucide-react";

export function HelpDialog({ onClose }: { onClose: () => void }) {
  const section = "text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 mt-4 first:mt-0";
  const row = "flex items-center justify-between gap-8 py-0.5";
  const kbd = "rounded bg-muted px-1.5 py-0.5 text-xs font-mono";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={onClose}
      aria-hidden="false"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-title"
        className="relative w-full max-w-md rounded-lg border border-border bg-popover p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 id="help-title" className="flex items-center gap-2 text-base font-semibold">
            <Keyboard className="h-4 w-4" aria-hidden="true" />
            Keyboard Shortcuts
          </h2>
          <button
            aria-label="Close keyboard shortcuts"
            className="rounded p-1 text-muted-foreground hover:bg-muted"
            onClick={onClose}
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="text-sm">
          <p className={section}>Navigation</p>
          <div className={row}><span>Settings</span><kbd className={kbd}>Alt+,</kbd></div>
          <div className={row}><span>Focus left navigation</span><kbd className={kbd}>Alt+N</kbd></div>
          <div className={row}><span>Move in left navigation</span><kbd className={kbd}>↑ ↓ Home End</kbd></div>
          <div className={row}><span>Expand / collapse section</span><kbd className={kbd}>← →</kbd></div>
          <div className={row}><span>Open focused navigation item</span><kbd className={kbd}>Enter</kbd></div>
          <div className={row}><span>Typeahead in navigation</span><kbd className={kbd}>A–Z</kbd></div>
          <div className={row}><span>Sync now</span><kbd className={kbd}>Alt+S</kbd></div>
          <div className={row}><span>Refresh current view</span><kbd className={kbd}>Ctrl+R</kbd></div>
          <div className={row}><span>Command palette</span><kbd className={kbd}>Ctrl+K</kbd></div>
          <div className={row}><span>Focus grid</span><kbd className={kbd}>Alt+G</kbd></div>
          <div className={row}><span>Focus preview</span><kbd className={kbd}>Alt+P</kbd></div>
          <div className={row}><span>Grid → preview / back to grid</span><kbd className={kbd}>Enter / → · Esc / ←</kbd></div>
          <div className={row}><span>Focus views panel</span><kbd className={kbd}>Alt+V</kbd></div>

          <p className={section}>My Reviews</p>
          <div className={row}><span>Focus search</span><kbd className={kbd}>/</kbd></div>
          <div className={row}><span>Open / focus preview</span><kbd className={kbd}>Enter / →</kbd></div>
          <div className={row}><span>Open in Azure DevOps</span><kbd className={kbd}>O / Ctrl+Enter</kbd></div>
          <div className={row}><span>Vote: Approve / Suggestions / Wait / Reject / None</span><kbd className={kbd}>A / S / W / X / 0</kbd></div>
          <div className={row}><span>Collapse / expand section</span><kbd className={kbd}>click header</kbd></div>
          <div className={row}><span>Maximize preview</span><kbd className={kbd}>\</kbd></div>
          <div className={row}><span>Show drafts</span><kbd className={kbd}>D</kbd></div>
          <div className={row}><span>Copy URL</span><kbd className={kbd}>C</kbd></div>
          <div className={row}><span>Snooze selected row</span><kbd className={kbd}>Z</kbd></div>
          <div className={row}><span>Move row</span><kbd className={kbd}>J/K ↑ ↓ PgUp PgDn Home End</kbd></div>

          <p className={section}>PR Search / WI Search / Commits</p>
          <div className={row}><span>Focus search</span><kbd className={kbd}>/</kbd></div>
          <div className={row}><span>Open / focus preview</span><kbd className={kbd}>Enter / →</kbd></div>
          <div className={row}><span>Open in Azure DevOps</span><kbd className={kbd}>O / Ctrl+Enter</kbd></div>
          <div className={row}><span>Maximize preview</span><kbd className={kbd}>\</kbd></div>
          <div className={row}><span>Copy URL</span><kbd className={kbd}>C</kbd></div>
          <div className={row}><span>Move row</span><kbd className={kbd}>J/K ↑ ↓ PgUp PgDn Home End</kbd></div>
          <div className={row}><span>Mark done / restore (My Reviews, My Items)</span><kbd className={kbd}>E</kbd></div>

          <p className={section}>Work Items</p>
          <div className={row}><span>Focus search</span><kbd className={kbd}>/</kbd></div>
          <div className={row}><span>Open detail preview</span><kbd className={kbd}>Enter / →</kbd></div>
          <div className={row}><span>Open in Azure DevOps</span><kbd className={kbd}>Ctrl+Enter / O</kbd></div>
          <div className={row}><span>Move row</span><kbd className={kbd}>J/K ↑ ↓ PgUp PgDn Home End</kbd></div>
          <div className={row}><span>Select row</span><kbd className={kbd}>Space</kbd></div>
          <div className={row}><span>Assign selected item</span><kbd className={kbd}>A</kbd></div>
          <div className={row}><span>Change state</span><kbd className={kbd}>S</kbd></div>
          <div className={row}><span>Change priority</span><kbd className={kbd}>P</kbd></div>
          <div className={row}><span>Edit custom field (press again for next)</span><kbd className={kbd}>F</kbd></div>
          <div className={row}><span>Apply pending property changes</span><kbd className={kbd}>Ctrl+S</kbd></div>
          <div className={row}><span>Discard pending property changes</span><kbd className={kbd}>Esc</kbd></div>
          <div className={row}><span>Undo last apply (10s window)</span><kbd className={kbd}>U</kbd></div>
          <div className={row}><span>Focus comment</span><kbd className={kbd}>Alt+M / M</kbd></div>
          <div className={row}><span>Post comment (+ apply pending changes)</span><kbd className={kbd}>Ctrl+Enter</kbd></div>
          <div className={row}><span>Return to grid (from input / preview)</span><kbd className={kbd}>Esc / ←</kbd></div>
          <div className={row}><span>Snooze selected row (My Items)</span><kbd className={kbd}>Z</kbd></div>

          <p className={section}>Work Item Views</p>
          <div className={row}><span>Move view card</span><kbd className={kbd}>← → ↑ ↓</kbd></div>
          <div className={row}><span>Add / edit view</span><kbd className={kbd}>N / E</kbd></div>
          <div className={row}><span>Run views / delete</span><kbd className={kbd}>R / Del</kbd></div>
          <div className={row}><span>Save (in dialog)</span><kbd className={kbd}>Ctrl+Enter</kbd></div>

          <p className={section}>General</p>
          <div className={row}><span>Go to view</span><kbd className={kbd}>G then R/P/W/T/I/V/C/S</kbd></div>
          <div className={row}><span>Show this help</span><kbd className={kbd}>F1 / ?</kbd></div>
          <div className={row}><span>Close dialog</span><kbd className={kbd}>Esc</kbd></div>
        </div>
      </div>
    </div>
  );
}
