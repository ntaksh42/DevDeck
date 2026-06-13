import { type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

export function NavButton({
  active,
  disabled = false,
  icon,
  label,
  shortcut,
  onClick,
}: {
  active: boolean;
  disabled?: boolean;
  icon: ReactNode;
  label: string;
  shortcut?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-label={label}
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

export function NavSubItem({
  active,
  disabled = false,
  label,
  onClick,
}: {
  active: boolean;
  disabled?: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-label={label}
      data-nav-item="true"
      data-nav-active={active ? "true" : undefined}
      data-nav-label={label}
      className={`group flex h-7 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-sm outline-none focus:ring-2 focus:ring-ring ${
        active ? "bg-secondary font-medium text-foreground" : "text-muted-foreground hover:bg-secondary"
      } disabled:cursor-not-allowed disabled:opacity-50`}
    >
      <span className="min-w-0 truncate">{label}</span>
    </button>
  );
}
