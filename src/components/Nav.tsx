import { type ReactNode } from "react";

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
      aria-keyshortcuts={shortcut}
      className={`flex h-8 w-full items-center gap-2 rounded-md px-2.5 text-left text-sm font-medium ${
        active ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-secondary"
      } disabled:cursor-not-allowed disabled:opacity-50`}
    >
      {icon}
      {label}
    </button>
  );
}

export function NavSection({
  icon,
  label,
  disabled = false,
  children,
}: {
  icon: ReactNode;
  label: string;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={disabled ? "opacity-50" : ""}>
      <div className="flex h-8 items-center gap-2 px-2.5 text-sm font-semibold text-foreground">
        {icon}
        {label}
      </div>
      <div className="ml-3 space-y-0.5 border-l border-border pl-4">
        {children}
      </div>
    </div>
  );
}

export function NavSubItem({
  active,
  disabled = false,
  label,
  shortcut,
  onClick,
}: {
  active: boolean;
  disabled?: boolean;
  label: string;
  shortcut?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-keyshortcuts={shortcut}
      className={`flex h-7 w-full items-center rounded-md px-2 text-left text-sm ${
        active ? "bg-secondary font-medium text-foreground" : "text-muted-foreground hover:bg-secondary"
      } disabled:cursor-not-allowed disabled:opacity-50`}
    >
      {label}
    </button>
  );
}
