import { useEffect, useRef } from "react";
import { Keyboard, X } from "lucide-react";
import { resolveKeybindings, type KeybindingId } from "@/lib/keybindings";
import type { HelpSection } from "@/lib/helpEvents";

export function HelpDialog({ onClose, section: targetSection }: { onClose: () => void; section?: HelpSection }) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  // Focus the close button on open so the dialog is keyboard-operable from the
  // start; Escape closes (App returns focus to the opener). (#443)
  useEffect(() => {
    closeButtonRef.current?.focus();
    // Opened from a view's `?` button: bring that view's key section into view.
    if (targetSection) {
      document
        .querySelector(`[data-help-section="${targetSection}"]`)
        ?.scrollIntoView?.({ block: "start" });
    }
  }, [targetSection]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    }
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [onClose]);

  const section = "text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2";
  // The section a view's `?` button asked for is drawn in the accent colour.
  const sectionProps = (id: HelpSection) => ({
    "data-help-section": id,
    className: id === targetSection ? "mb-2 text-xs font-semibold uppercase tracking-wider text-primary" : section,
  });
  // Spacing sits on the section wrapper: each heading is its own wrapper's
  // first child, so a `first:` margin on the heading never separated sections.
  const group = "break-inside-avoid mt-4 first:mt-0";
  const row = "flex items-center justify-between gap-8 py-0.5";
  const kbd = "rounded bg-muted px-1.5 py-0.5 text-xs font-mono";

  // Effective combos for the rebindable app-level shortcuts. Grid-local rows
  // below stay static because those keys are not customizable yet.
  const keys = resolveKeybindings();
  const combo = (id: KeybindingId) => keys[id];
  const gotoKeys = [
    combo("gotoMyReviews"),
    combo("gotoPullRequestSearch"),
    combo("gotoMyWorkItems"),
    combo("gotoWorkItemSearch"),
    combo("gotoWorkItemViews"),
    combo("gotoNotifications"),
    combo("gotoInbox"),
    combo("gotoSettings"),
  ].join("/");

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
        className="relative flex max-h-[85vh] w-full max-w-4xl flex-col rounded-lg border border-border bg-popover p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex shrink-0 items-center justify-between">
          <h2 id="help-title" className="flex items-center gap-2 text-base font-semibold">
            <Keyboard className="h-4 w-4" aria-hidden="true" />
            Keyboard Shortcuts
          </h2>
          <button
            ref={closeButtonRef}
            aria-label="Close keyboard shortcuts"
            className="rounded p-1 text-muted-foreground hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring"
            onClick={onClose}
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto pr-1 text-sm" tabIndex={0}>
        <div className="md:columns-2 md:gap-8">
        <div className={group}>
          <p className={section}>Navigation</p>
          <div className={row}><span>Settings</span><kbd className={kbd}>{combo("openSettings")}</kbd></div>
          <div className={row}><span>Focus left navigation</span><kbd className={kbd}>{combo("focusNavigation")}</kbd></div>
          <div className={row}><span>Collapse / expand left navigation</span><kbd className={kbd}>{combo("toggleSidebar")}</kbd></div>
          <div className={row}><span>Open / close the Agent panel (ask about the selected item from any view)</span><kbd className={kbd}>{combo("toggleAgent")}</kbd></div>
          <div className={row}><span>Agent panel: move / fold-unfold conversation / reply / new request / close</span><kbd className={kbd}>↑↓ / → ← / R / M / Esc</kbd></div>
          <div className={row}><span>Agent panel: show in result / re-attach / resolve-reopen / delete / undo delete</span><kbd className={kbd}>Enter / L / X / Del / Ctrl+Z</kbd></div>
          <div className={row}><span>Move in left navigation</span><kbd className={kbd}>↑ ↓ Home End</kbd></div>
          <div className={row}><span>Reorder navigation entry</span><kbd className={kbd}>Alt+↑ / Alt+↓</kbd></div>
          <div className={row}><span>Expand / collapse section</span><kbd className={kbd}>← →</kbd></div>
          <div className={row}><span>Open focused navigation item</span><kbd className={kbd}>Enter</kbd></div>
          <div className={row}><span>Typeahead in navigation</span><kbd className={kbd}>A–Z</kbd></div>
          <div className={row}><span>Back / forward through views</span><kbd className={kbd}>Alt+← / Alt+→</kbd></div>
          <div className={row}><span>Sync now</span><kbd className={kbd}>{combo("syncNow")}</kbd></div>
          <div className={row}><span>Refresh current view</span><kbd className={kbd}>{combo("refreshCurrentView")}</kbd></div>
          <div className={row}><span>Command palette</span><kbd className={kbd}>{combo("commandPalette")}</kbd></div>
          <div className={row}><span>Focus grid</span><kbd className={kbd}>{combo("focusGrid")}</kbd></div>
          <div className={row}><span>Focus preview</span><kbd className={kbd}>{combo("focusPreview")}</kbd></div>
          <div className={row}><span>Adjacent grid / editable pane (from rows / preview body)</span><kbd className={kbd}>← →</kbd></div>
          <div className={row}><span>Grid → preview / back to grid</span><kbd className={kbd}>Enter / → · Esc / ←</kbd></div>
          <div className={row}><span>Focus views panel</span><kbd className={kbd}>{combo("focusViewsPanel")}</kbd></div>

        </div>
        <div className={group}>
          <p {...sectionProps("reviews")}>My Reviews</p>
          <div className={row}><span>Focus search</span><kbd className={kbd}>/</kbd></div>
          <div className={row}><span>Open / focus preview</span><kbd className={kbd}>Enter / →</kbd></div>
          <div className={row}><span>Open in Azure DevOps</span><kbd className={kbd}>O / Ctrl+Enter</kbd></div>
          <div className={row}><span>Vote: Approve / Suggestions / Wait / Reject / None</span><kbd className={kbd}>A / S / W / X / 0</kbd></div>
          <div className={row}><span>Collapse / expand section</span><kbd className={kbd}>Tab to header · Enter</kbd></div>
          <div className={row}><span>Maximize preview</span><kbd className={kbd}>\</kbd></div>
          <div className={row}><span>Show drafts</span><kbd className={kbd}>D</kbd></div>
          <div className={row}><span>Copy URL</span><kbd className={kbd}>C</kbd></div>
          <div className={row}><span>Copy as Grid: selected rows as a table (paste into email)</span><kbd className={kbd}>Ctrl+C</kbd></div>
          <div className={row}><span>Copy as Link: one link per selected row</span><kbd className={kbd}>Ctrl+Shift+C</kbd></div>
          <div className={row}><span>Copy as Markdown link</span><kbd className={kbd}>L</kbd></div>
          <div className={row}><span>Snooze selected row</span><kbd className={kbd}>Z</kbd></div>
          <div className={row}><span>Comment on the review result (Result tab, also PR Search)</span><kbd className={kbd}>R</kbd></div>
          <div className={row}><span>Focus PR comment</span><kbd className={kbd}>{combo("focusComment")} / M</kbd></div>
          <div className={row}><span>Move row</span><kbd className={kbd}>J/K ↑ ↓ PgUp PgDn Home End</kbd></div>
          <div className={row}><span>Jump to next / previous PR needing action (My Pull Requests)</span><kbd className={kbd}>N / Shift+N</kbd></div>
          <div className={row}><span>Select multiple (check file-overlap conflict risk)</span><kbd className={kbd}>Shift+↑ ↓ · Shift+click · Ctrl+click</kbd></div>

        </div>
        <div className={group}>
          <p {...sectionProps("pr-search")}>PR Search / WI Search</p>
          <div className={row}><span>Focus search</span><kbd className={kbd}>/</kbd></div>
          <div className={row}><span>Open / focus preview</span><kbd className={kbd}>Enter / →</kbd></div>
          <div className={row}><span>Open in Azure DevOps</span><kbd className={kbd}>O / Ctrl+Enter</kbd></div>
          <div className={row}><span>Maximize preview</span><kbd className={kbd}>\</kbd></div>
          <div className={row}><span>Copy URL</span><kbd className={kbd}>C</kbd></div>
          <div className={row}><span>Copy as Grid: selected rows as a table</span><kbd className={kbd}>Ctrl+C</kbd></div>
          <div className={row}><span>Copy as Link: one link per selected row</span><kbd className={kbd}>Ctrl+Shift+C</kbd></div>
          <div className={row}><span>Copy as Markdown link</span><kbd className={kbd}>L</kbd></div>
          <div className={row}><span>Move row</span><kbd className={kbd}>J/K ↑ ↓ PgUp PgDn Home End</kbd></div>
          <div className={row}><span>Select multiple</span><kbd className={kbd}>Shift+↑ ↓ · Shift+click · Ctrl+click</kbd></div>
          <div className={row}><span>Mark done / restore (My Reviews, My Items)</span><kbd className={kbd}>E</kbd></div>

        </div>
        <div className={group}>
          <p {...sectionProps("work-items")}>Work Items</p>
          <div className={row}><span>Focus search</span><kbd className={kbd}>/</kbd></div>
          <div className={row}><span>Open detail preview</span><kbd className={kbd}>Enter / →</kbd></div>
          <div className={row}><span>Open in Azure DevOps</span><kbd className={kbd}>Ctrl+Enter / O</kbd></div>
          <div className={row}><span>Copy URL</span><kbd className={kbd}>C</kbd></div>
          <div className={row}><span>Copy as Grid: selected rows as a table (paste into email)</span><kbd className={kbd}>Ctrl+C</kbd></div>
          <div className={row}><span>Copy as Link: one link per selected row</span><kbd className={kbd}>Ctrl+Shift+C</kbd></div>
          <div className={row}><span>Copy as Markdown link</span><kbd className={kbd}>L</kbd></div>
          <div className={row}><span>Move row</span><kbd className={kbd}>J/K ↑ ↓ PgUp PgDn Home End</kbd></div>
          <div className={row}><span>Select row</span><kbd className={kbd}>Space · Shift+click · Ctrl+click</kbd></div>
          <div className={row}><span>Assign selected item</span><kbd className={kbd}>A</kbd></div>
          <div className={row}><span>Change state</span><kbd className={kbd}>S</kbd></div>
          <div className={row}><span>Change priority</span><kbd className={kbd}>P</kbd></div>
          <div className={row}><span>Edit custom field (press again for next)</span><kbd className={kbd}>F</kbd></div>
          <div className={row}><span>Duplicate into a new item (preview)</span><kbd className={kbd}>D</kbd></div>
          <div className={row}><span>Apply pending property changes</span><kbd className={kbd}>Ctrl+S</kbd></div>
          <div className={row}><span>Discard pending property changes</span><kbd className={kbd}>Esc</kbd></div>
          <div className={row}><span>Undo last apply (10s window)</span><kbd className={kbd}>U</kbd></div>
          <div className={row}><span>Focus comment</span><kbd className={kbd}>{combo("focusComment")} / M</kbd></div>
          <div className={row}><span>Post comment (+ apply pending changes)</span><kbd className={kbd}>Ctrl+Enter</kbd></div>
          <div className={row}><span>Return to grid (from input / preview)</span><kbd className={kbd}>Esc / ←</kbd></div>
          <div className={row}><span>Reorder / move preview section (header focused; or drag)</span><kbd className={kbd}>Alt+↑ ↓ / Alt+← →</kbd></div>
          <div className={row}><span>Snooze selected row (My Items / Views / Search)</span><kbd className={kbd}>Z</kbd></div>
          <div className={row}><span>Comment on the investigation result (Result panel)</span><kbd className={kbd}>R</kbd></div>
          <div className={row}><span>Result: move block / extend</span><kbd className={kbd}>↑ ↓ / Shift+↑ ↓</kbd></div>
          <div className={row}><span>Result: comment / open note / next-prev note</span><kbd className={kbd}>C / Enter / ] [</kbd></div>
          <div className={row}><span>Result: ask the agent about the selected text / open Agent panel / open in browser</span><kbd className={kbd}>C / A / O</kbd></div>
          <div className={row}><span>Note box: send / add to drafts / send all drafts</span><kbd className={kbd}>Ctrl+Enter / Alt+Enter / Ctrl+Shift+Enter</kbd></div>

        </div>
        <div className={group}>
          <p className={section}>Work Item Views</p>
          <div className={row}><span>Move view card</span><kbd className={kbd}>← → ↑ ↓</kbd></div>
          <div className={row}><span>Add / edit view</span><kbd className={kbd}>N / E</kbd></div>
          <div className={row}><span>Run views / delete</span><kbd className={kbd}>R / Del</kbd></div>
          <div className={row}><span>Save (in dialog)</span><kbd className={kbd}>Ctrl+Enter</kbd></div>

        </div>
        <div className={group}>
          <p className={section}>Code</p>
          <div className={row}><span>Find file by name (fuzzy)</span><kbd className={kbd}>T</kbd></div>
          <div className={row}><span>Move in tree / type-ahead</span><kbd className={kbd}>↑ ↓ · Home / End · type</kbd></div>

          <p {...sectionProps("pipelines")}>Pipelines</p>
          <div className={row}><span>Move between watched pipelines</span><kbd className={kbd}>J/K ↑ ↓ Home End</kbd></div>
          <div className={row}><span>Expand / collapse runs · unwatch</span><kbd className={kbd}>Enter · Delete</kbd></div>
          <div className={row}><span>Move run row</span><kbd className={kbd}>J/K ↑ ↓ Home End</kbd></div>
          <div className={row}><span>Open run preview</span><kbd className={kbd}>Enter</kbd></div>
          <div className={row}><span>Open run in browser</span><kbd className={kbd}>Ctrl+Enter</kbd></div>

        </div>
        <div className={group}>
          <p {...sectionProps("inbox")}>Inbox</p>
          <div className={row}><span>Priority (direct PR / WI mentions) / Other (team mentions and replies) / All: Tab to the filter in the tab strip, arrows switch, Enter returns to items</span><kbd className={kbd}>← → / ↑ ↓</kbd></div>
          <div className={row}><span>Move row</span><kbd className={kbd}>J/K ↑ ↓ Home End PgUp PgDn</kbd></div>
          <div className={row}><span>Focus the preview</span><kbd className={kbd}>Enter / →</kbd></div>
          <div className={row}><span>Open in DevDeck</span><kbd className={kbd}>Shift+Enter</kbd></div>
          <div className={row}><span>Open in Azure DevOps</span><kbd className={kbd}>O / Ctrl+Enter</kbd></div>
          <div className={row}><span>Done / Reopen (then the next row is selected)</span><kbd className={kbd}>E</kbd></div>
          <div className={row}><span>Resolve the thread + Done</span><kbd className={kbd}>Shift+E</kbd></div>
          <div className={row}><span>Snooze / Unsnooze (presets: 1-5 in the menu)</span><kbd className={kbd}>Z</kbd></div>
          <div className={row}><span>Mark the row / extend the marked range (E and Z then apply to all marked; Esc clears)</span><kbd className={kbd}>X / Shift+↑↓</kbd></div>
          <div className={row}><span>Undo the last Done / Snooze / Reopen (all items of a bulk change)</span><kbd className={kbd}>U</kbd></div>
          <div className={row}><span>Scroll the preview from the list</span><kbd className={kbd}>Space / Shift+Space</kbd></div>
          <div className={row}><span>Expand / collapse the description</span><kbd className={kbd}>D</kbd></div>
          <div className={row}><span>Focus comment (reply)</span><kbd className={kbd}>{combo("focusComment")} / M</kbd></div>
          <div className={row}><span>Reply with Claude's draft (edit, then send)</span><kbd className={kbd}>Shift+R</kbd></div>
          <div className={row}><span>Post the reply / post and resolve the thread (in the reply box)</span><kbd className={kbd}>Ctrl+Enter · Ctrl+Shift+Enter</kbd></div>
          <div className={row}><span>Ask the agent (opens the Agent panel)</span><kbd className={kbd}>Q</kbd></div>
          <div className={row}><span>Open the nth related link</span><kbd className={kbd}>1-9</kbd></div>
          <div className={row}><span>Filter</span><kbd className={kbd}>/ · Ctrl+F</kbd></div>

          <p className={section}>Notifications</p>
          <div className={row}><span>Move row</span><kbd className={kbd}>J/K ↑ ↓ Home End PgUp PgDn</kbd></div>
          <div className={row}><span>Open / jump to item (marks read)</span><kbd className={kbd}>Enter</kbd></div>
          <div className={row}><span>Open in Azure DevOps (marks read)</span><kbd className={kbd}>Ctrl+Enter</kbd></div>
          <div className={row}><span>Mark selected read</span><kbd className={kbd}>R</kbd></div>

        </div>
        <div className={group}>
          <p className={section}>General</p>
          <div className={row}><span>Go to view</span><kbd className={kbd}>{combo("gotoLeader")} then {gotoKeys}</kbd></div>
          <div className={row}><span>Apply pending work item changes</span><kbd className={kbd}>{combo("applyStaged")}</kbd></div>
          <div className={row}><span>Back from the Done / Snoozed list to the open list (Inbox, My Reviews, Work Items)</span><kbd className={kbd}>Esc</kbd></div>
          <div className={row}><span>Show this help</span><kbd className={kbd}>F1 / {combo("help")}</kbd></div>
          <div className={row}><span>Close dialog</span><kbd className={kbd}>Esc</kbd></div>
        </div>
        </div>
        </div>
      </div>
    </div>
  );
}
