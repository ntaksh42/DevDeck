import type { ReactNode } from "react";

// Light blue section band shared by preview panes that don't use a collapsible
// section (commit / pipeline run). Same look as PrPreviewSection's header so
// every preview reads as one consistent stack. `action` renders on the right.
export function PreviewBand({ action, children }: { action?: ReactNode; children: ReactNode }) {
  return (
    <div className="mx-2 my-1 flex items-center gap-1 rounded border-l-4 border-l-primary bg-info/10 px-1.5 py-1 text-2xs font-semibold uppercase tracking-wide leading-4 text-foreground">
      <h3 className="min-w-0 flex-1 truncate">{children}</h3>
      {action ? <div className="shrink-0 normal-case">{action}</div> : null}
    </div>
  );
}
