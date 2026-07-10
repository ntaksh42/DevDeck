import { type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

export function NavButton({
  active,
  disabled = false,
  icon,
  label,
  shortcut,
  badge,
  onClick,
}: {
  active: boolean;
  disabled?: boolean;
  icon: ReactNode;
  label: string;
  shortcut?: string;
  badge?: number | null;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-label={navItemAriaLabel(label, badge)}
      aria-keyshortcuts={shortcut}
      data-nav-item="true"
      data-nav-active={active ? "true" : undefined}
      data-nav-label={label}
      className={`group flex h-8 w-full min-w-0 items-center gap-2 rounded-md px-2.5 text-left text-sm font-medium outline-none focus:ring-2 focus:ring-ring ${
        active ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-secondary"
      } disabled:cursor-not-allowed disabled:opacity-50`}
    >
      <span className="shrink-0">{icon}</span>
      <span className="min-w-0 truncate">{label}</span>
      <NavBadge count={badge} />
    </button>
  );
}

export function NavSection({
  id,
  icon,
  label,
  disabled = false,
  expanded = true,
  onExpandedChange,
  children,
}: {
  id: string;
  icon: ReactNode;
  label: string;
  disabled?: boolean;
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  children: ReactNode;
}) {
  return (
    <div className={disabled ? "opacity-50" : ""}>
      <button
        type="button"
        disabled={disabled}
        aria-expanded={expanded}
        data-nav-item="true"
        data-nav-section="true"
        data-section-id={id}
        data-nav-label={label}
        onClick={() => onExpandedChange?.(!expanded)}
        className="group flex h-8 w-full min-w-0 items-center gap-2 rounded-md px-2.5 text-left text-sm font-semibold text-foreground outline-none hover:bg-secondary focus:ring-2 focus:ring-ring disabled:cursor-not-allowed"
      >
        <span className="shrink-0">{icon}</span>
        <span className="min-w-0 truncate">{label}</span>
        {expanded ? (
          <ChevronDown className="ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        ) : (
          <ChevronRight className="ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        )}
      </button>
      <div className={`ml-3 space-y-0.5 border-l border-border pl-4 ${expanded ? "" : "hidden"}`}>
        {children}
      </div>
    </div>
  );
}

// A small count pill shown on the right of a nav item. Hidden for null/0 so an
// empty inbox doesn't show a noisy "0". Purely visual: the count is announced via
// the owning button's aria-label (see navItemAriaLabel) because a button's
// aria-label otherwise overrides any nested text/aria from this badge.
function NavBadge({ count }: { count: number | null | undefined }) {
  if (count == null || count <= 0) return null;
  return (
    <span
      aria-hidden="true"
      className="ml-auto shrink-0 rounded-full bg-secondary px-1.5 text-[11px] font-medium tabular-nums text-muted-foreground group-hover:bg-background/70"
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

// The accessible name for a nav item, folding the badge count in so screen
// readers announce e.g. "My Reviews, 2" instead of just "My Reviews".
function navItemAriaLabel(label: string, badge?: number | null): string {
  return badge != null && badge > 0 ? `${label}, ${badge}` : label;
}

export function NavSubItem({
  active,
  disabled = false,
  label,
  badge,
  onClick,
}: {
  active: boolean;
  disabled?: boolean;
  label: string;
  badge?: number | null;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-label={navItemAriaLabel(label, badge)}
      data-nav-item="true"
      data-nav-active={active ? "true" : undefined}
      data-nav-label={label}
      className={`group flex h-7 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-sm outline-none focus:ring-2 focus:ring-ring ${
        active ? "bg-secondary font-medium text-foreground" : "text-muted-foreground hover:bg-secondary"
      } disabled:cursor-not-allowed disabled:opacity-50`}
    >
      <span className="min-w-0 truncate">{label}</span>
      <NavBadge count={badge} />
    </button>
  );
}

// A sub-item that navigates on click and, when it has children, can expand or
// collapse them via a separate chevron toggle. Clicking the label navigates;
// clicking the chevron only toggles. Children render indented one level deeper.
export function NavSubGroup({
  id,
  active,
  disabled = false,
  label,
  badge,
  expandable,
  expanded,
  onToggle,
  onClick,
  children,
}: {
  id: string;
  active: boolean;
  disabled?: boolean;
  label: string;
  badge?: number | null;
  expandable: boolean;
  expanded: boolean;
  onToggle: () => void;
  onClick: () => void;
  children?: ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-0.5">
        <button
          type="button"
          disabled={disabled}
          onClick={onClick}
          aria-label={navItemAriaLabel(label, badge)}
          data-nav-item="true"
          data-nav-active={active ? "true" : undefined}
          data-nav-label={label}
          data-nav-subgroup={expandable ? "true" : undefined}
          data-subgroup-id={id}
          className={`group flex h-7 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-left text-sm outline-none focus:ring-2 focus:ring-ring ${
            active ? "bg-secondary font-medium text-foreground" : "text-muted-foreground hover:bg-secondary"
          } disabled:cursor-not-allowed disabled:opacity-50`}
        >
          <span className="min-w-0 truncate">{label}</span>
          <NavBadge count={badge} />
        </button>
        {expandable && (
          <button
            type="button"
            disabled={disabled}
            onClick={onToggle}
            aria-label={`${expanded ? "Collapse" : "Expand"} ${label}`}
            aria-expanded={expanded}
            className="flex h-7 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-secondary focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          >
            {expanded ? (
              <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
            )}
          </button>
        )}
      </div>
      {expandable && expanded ? (
        <div className="ml-2 space-y-0.5 border-l border-border pl-3">
          {children}
        </div>
      ) : null}
    </div>
  );
}
