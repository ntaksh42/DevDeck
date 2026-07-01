import { Star } from 'lucide-react';

/**
 * Follow/unfollow toggle for the work item preview header (issue #304).
 * A plain focusable `<button>` with `aria-pressed` so it is fully keyboard
 * operable (Tab to focus, Enter/Space to toggle) per AGENTS.md.
 */
export function WorkItemFollowToggle({
  isFollowed,
  onToggle,
  pending,
}: {
  isFollowed: boolean;
  onToggle: () => void;
  pending?: boolean;
}) {
  return (
    <button
      type="button"
      aria-pressed={isFollowed}
      aria-label={isFollowed ? 'Unfollow this work item' : 'Follow this work item'}
      title={isFollowed ? 'Following — click to unfollow' : 'Follow this work item'}
      onClick={onToggle}
      disabled={pending}
      className={`inline-flex h-5 w-5 items-center justify-center rounded border disabled:cursor-not-allowed disabled:opacity-50 ${
        isFollowed
          ? 'border-amber-400 bg-amber-50 text-amber-600 dark:bg-amber-950/40'
          : 'border-border bg-card text-muted-foreground hover:bg-secondary hover:text-foreground'
      }`}
    >
      <Star className="h-3 w-3" aria-hidden="true" fill={isFollowed ? 'currentColor' : 'none'} />
    </button>
  );
}
