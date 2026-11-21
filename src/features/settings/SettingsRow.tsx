import type { ReactNode } from 'react';

/**
 * Shared two-column settings row: name + short description on the left, the
 * controls on the right. Used by every panel so the page reads as one list.
 */
export function SettingsRow({
  title,
  description,
  children,
  ...rest
}: {
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
} & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...rest}
      className="grid gap-x-6 gap-y-2 py-3 md:grid-cols-[240px_minmax(0,1fr)]"
    >
      <div className="min-w-0">
        <h2 className="text-sm font-semibold">{title}</h2>
        {description ? (
          <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
        ) : null}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
