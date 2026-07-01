// Small presentational pieces of the Files view header: the right-pane tab
// buttons and the clickable breadcrumb.

export function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded px-2 py-0.5 ${
        active ? "bg-secondary font-medium" : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

// The current path as a clickable breadcrumb: the repository name navigates to
// the root, each intermediate segment to that folder. The last segment is the
// current location and stays plain text.
export function Breadcrumb({
  path,
  repositoryName,
  onNavigate,
}: {
  path: string;
  repositoryName: string;
  onNavigate: (path: string) => void;
}) {
  const segments = path.split("/").filter(Boolean);
  return (
    <nav aria-label="Current path" className="flex min-w-0 items-center gap-1 truncate text-sm">
      {segments.length === 0 ? (
        <span className="font-medium">{repositoryName}</span>
      ) : (
        <button
          type="button"
          onClick={() => onNavigate("/")}
          className="font-medium hover:underline"
        >
          {repositoryName}
        </button>
      )}
      {segments.map((segment, index) => {
        const target = "/" + segments.slice(0, index + 1).join("/");
        const isLast = index === segments.length - 1;
        return (
          <span key={target} className="flex items-center gap-1 text-muted-foreground">
            <span aria-hidden="true">/</span>
            {isLast ? (
              <span>{segment}</span>
            ) : (
              <button
                type="button"
                onClick={() => onNavigate(target)}
                className="hover:text-foreground hover:underline"
              >
                {segment}
              </button>
            )}
          </span>
        );
      })}
    </nav>
  );
}
