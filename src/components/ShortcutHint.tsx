import { type ReactNode } from "react";

export function ShortcutHint({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-4 items-center rounded border border-border bg-muted px-1 font-mono text-[10px] font-medium leading-none text-muted-foreground">
      {children}
    </kbd>
  );
}
