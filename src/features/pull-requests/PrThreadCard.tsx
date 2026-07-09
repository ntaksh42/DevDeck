import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, ChevronRight } from "lucide-react";
import { type MentionCandidate, type PrThread } from "@/lib/azdoCommands";
import { focusPrimaryPreview, formatDate, formatRelativeDate } from "@/lib/utils";
import { MarkdownView } from "@/lib/markdown";
import { CommentComposer } from "./CommentComposer";

const AVATAR_PALETTE = [
  "bg-sky-100 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300",
  "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300",
  "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300",
  "bg-violet-100 text-violet-700 dark:bg-violet-950/50 dark:text-violet-300",
  "bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300",
  "bg-teal-100 text-teal-700 dark:bg-teal-950/50 dark:text-teal-300",
];

function authorInitials(name: string | null | undefined): string {
  const normalized = name?.trim();
  if (!normalized) return "?";
  const parts = normalized.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
  return [...normalized].slice(0, 2).join("").toUpperCase();
}

/** Initials avatar; background color is picked from a small fixed palette by
 * hashing the author's name, so the same person always gets the same color. */
function CommentAvatar({ name }: { name: string | null | undefined }) {
  let hash = 0;
  for (const char of name ?? "?") hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0;
  const colorClass = AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
  return (
    <span
      aria-hidden="true"
      className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-semibold ${colorClass}`}
    >
      {authorInitials(name)}
    </span>
  );
}

/**
 * Active/Resolved status dropdown (Azure DevOps "Active ▾" style). Only two
 * options exist because `setPullRequestThreadStatus` only accepts
 * "active" | "closed" — do not add more statuses here without backend support.
 * Keyboard: opens focused on the first option, arrows move, Enter/Space
 * activate the focused option (native button behavior), Escape closes and
 * returns focus to the trigger.
 */
function ThreadStatusDropdown({
  resolved,
  busy,
  onSetResolved,
}: {
  resolved: boolean;
  busy: boolean;
  onSetResolved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  function close() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  return (
    <div className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={busy}
        onClick={() => setOpen((value) => !value)}
        className={`inline-flex shrink-0 items-center gap-0.5 rounded border px-1.5 py-px text-[10px] font-medium disabled:opacity-50 ${
          resolved
            ? "border-border bg-muted text-muted-foreground"
            : "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-300"
        }`}
      >
        {resolved ? "Resolved" : "Active"}
        <ChevronDown className="h-2.5 w-2.5" aria-hidden="true" />
      </button>
      {open ? (
        <ThreadStatusPopup
          resolved={resolved}
          triggerRef={triggerRef}
          onClose={close}
          onSelect={(next) => {
            close();
            if (next !== resolved) onSetResolved();
          }}
        />
      ) : null}
    </div>
  );
}

function ThreadStatusPopup({
  resolved,
  triggerRef,
  onClose,
  onSelect,
}: {
  resolved: boolean;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  onSelect: (resolved: boolean) => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);

  // Focus the first option on open so the whole flow is keyboard-driven.
  useEffect(() => {
    menuRef.current?.querySelector<HTMLElement>('[data-status-item="true"]')?.focus();
  }, []);

  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      const target = e.target as Node;
      if (menuRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      onClose();
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [onClose, triggerRef]);

  // Capture-phase guard so no keystroke reaches whatever grid sits behind the
  // popup, matching PrOverflowMenu/SnoozeMenu.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }
      if (menuRef.current?.contains(e.target as Node)) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        e.stopPropagation();
        moveFocus(1);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        e.stopPropagation();
        moveFocus(-1);
      }
    }
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose]);

  function moveFocus(delta: number) {
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>('[data-status-item="true"]') ?? [],
    );
    if (items.length === 0) return;
    const active = document.activeElement as HTMLElement | null;
    const current = active ? items.indexOf(active) : -1;
    const next = (current + delta + items.length) % items.length;
    items[next]?.focus();
  }

  function handleMenuKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      e.stopPropagation();
      moveFocus(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      e.stopPropagation();
      moveFocus(-1);
    } else if (e.key === "Enter" || e.key === " ") {
      // Let the focused option's own click fire; just keep it off the grid.
      e.stopPropagation();
    }
  }

  const rect = triggerRef.current?.getBoundingClientRect() ?? null;
  const top = rect ? Math.min(rect.bottom + 2, window.innerHeight - 90) : 40;
  const left = rect ? Math.min(rect.left, window.innerWidth - 130) : 8;

  return (
    <div
      ref={menuRef}
      role="listbox"
      aria-label="Thread status"
      onKeyDown={handleMenuKeyDown}
      className="fixed z-50 w-28 rounded-md border border-border bg-popover p-1 shadow-lg"
      style={{ top, left }}
    >
      {([false, true] as const).map((isResolved) => {
        const selected = isResolved === resolved;
        return (
          <button
            key={String(isResolved)}
            type="button"
            role="option"
            aria-selected={selected}
            data-status-item="true"
            onClick={() => onSelect(isResolved)}
            className={`flex w-full items-center justify-between gap-2 rounded px-2 py-1 text-left text-xs hover:bg-secondary focus:outline-none focus:ring-1 focus:ring-ring focus:bg-secondary ${
              selected ? "font-medium" : ""
            }`}
          >
            {isResolved ? "Resolved" : "Active"}
            {selected ? <Check className="h-3 w-3" aria-hidden="true" /> : null}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Shared thread card used by the Review tab and the inline diff view.
 * Replies go through CommentComposer (plain-text editor with mentions), which
 * keeps the draft when a post fails.
 */
export function PrThreadCard({
  thread,
  busy,
  showFilePath = true,
  onReply,
  onToggleStatus,
  onEditComment,
  onDeleteComment,
  mentionSearch,
  resolveImageSource,
  baseUrl,
}: {
  thread: PrThread;
  busy: boolean;
  showFilePath?: boolean;
  onReply: (content: string) => Promise<void>;
  onToggleStatus: () => void;
  onEditComment?: (commentId: number, content: string) => Promise<void>;
  onDeleteComment?: (commentId: number) => Promise<void>;
  mentionSearch?: (query: string) => Promise<MentionCandidate[]>;
  resolveImageSource?: (url: string) => Promise<string | null>;
  baseUrl?: string | null;
}) {
  const [replying, setReplying] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const resolved = thread.isResolved;
  const visibleComments = thread.comments.filter((comment) => !comment.isSystem);
  const firstComment = visibleComments[0];

  return (
    <div
      className={`rounded-md border px-2 py-1.5 ${
        resolved ? "border-border bg-muted/60" : "border-border bg-card"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <button
            type="button"
            onClick={() => setCollapsed((value) => !value)}
            aria-expanded={!collapsed}
            aria-label={collapsed ? "Expand thread" : "Collapse thread"}
            className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-secondary hover:text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          >
            {collapsed ? (
              <ChevronRight className="h-3 w-3" aria-hidden="true" />
            ) : (
              <ChevronDown className="h-3 w-3" aria-hidden="true" />
            )}
          </button>
          {showFilePath && thread.filePath ? (
            <span
              className="truncate font-mono text-[10px] text-muted-foreground"
              title={`${thread.filePath}${thread.rightLine ? `:${thread.rightLine}` : ""}`}
            >
              {thread.filePath}
              {thread.rightLine ? `:${thread.rightLine}` : ""}
            </span>
          ) : null}
        </div>
        {/* Threads without a status are still user discussions; default them to
            active so the dropdown stays available (issue #434). */}
        <ThreadStatusDropdown resolved={resolved} busy={busy} onSetResolved={onToggleStatus} />
      </div>
      {collapsed ? (
        <div className="mt-1 flex min-w-0 items-center gap-1.5 text-xs">
          <CommentAvatar name={firstComment?.author} />
          <span className="shrink-0 font-medium text-foreground">
            {firstComment?.author ?? "Unknown"}
          </span>
          <span className="min-w-0 flex-1 truncate text-muted-foreground">
            {firstComment?.content ?? ""}
          </span>
        </div>
      ) : (
        <>
          <div className="mt-1 space-y-1.5">
            {visibleComments.map((comment) => (
              <div key={comment.id} className="group/comment text-xs">
                <div className="flex items-center gap-1.5">
                  <CommentAvatar name={comment.author} />
                  <span className="font-medium text-foreground">{comment.author ?? "Unknown"}</span>
                  {comment.publishedDate ? (
                    <span
                      className="text-[10px] text-muted-foreground"
                      title={formatDate(comment.publishedDate)}
                    >
                      {formatRelativeDate(comment.publishedDate)}
                    </span>
                  ) : null}
                  {comment.isMine && editingId !== comment.id && (onEditComment || onDeleteComment) ? (
                    <span className="ml-auto flex items-center gap-1 opacity-0 transition-opacity group-hover/comment:opacity-100">
                      {onEditComment ? (
                        <button
                          type="button"
                          onClick={() => setEditingId(comment.id)}
                          className="rounded px-1 py-px text-[10px] text-muted-foreground hover:bg-secondary hover:text-foreground"
                        >
                          Edit
                        </button>
                      ) : null}
                      {onDeleteComment ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            if (window.confirm("Delete this comment?")) {
                              void onDeleteComment(comment.id);
                            }
                          }}
                          className="rounded px-1 py-px text-[10px] text-muted-foreground hover:bg-secondary hover:text-destructive disabled:opacity-50"
                        >
                          Delete
                        </button>
                      ) : null}
                    </span>
                  ) : null}
                </div>
                {editingId === comment.id && onEditComment ? (
                  <div className="mt-1 pl-[26px]">
                    <CommentComposer
                      placeholder="Edit comment… (Ctrl+Enter to save)"
                      submitLabel="Save"
                      initialValue={comment.content ?? ""}
                      autoFocus
                      busy={busy}
                      mentionSearch={mentionSearch}
                      onSubmit={(content) => onEditComment(comment.id, content)}
                      onCancel={() => {
                        setEditingId(null);
                        focusPrimaryPreview();
                      }}
                      onSubmitted={() => {
                        setEditingId(null);
                        focusPrimaryPreview();
                      }}
                    />
                  </div>
                ) : (
                  <div className="pl-[26px]">
                    <MarkdownView
                      text={comment.content ?? ""}
                      className="text-foreground"
                      resolveImageSource={resolveImageSource}
                      baseUrl={baseUrl}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="mt-1.5">
            {replying ? (
              <CommentComposer
                placeholder="Reply… (Ctrl+Enter to post)"
                submitLabel="Reply"
                autoFocus
                busy={busy}
                mentionSearch={mentionSearch}
                onSubmit={onReply}
                onCancel={() => {
                  setReplying(false);
                  focusPrimaryPreview();
                }}
                onSubmitted={() => {
                  setReplying(false);
                  focusPrimaryPreview();
                }}
              />
            ) : (
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setReplying(true)}
                  className="min-w-0 flex-1 rounded-md border border-border bg-card px-2 py-1 text-left text-xs text-muted-foreground hover:bg-secondary focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  Write a reply…
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={onToggleStatus}
                  className="shrink-0 rounded border border-border bg-card px-2 py-1 text-xs text-muted-foreground hover:bg-secondary disabled:opacity-50"
                >
                  {resolved ? "Reactivate" : "Resolve"}
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
