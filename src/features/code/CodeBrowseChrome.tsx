// Small presentational pieces of the Files view header: the clickable
// breadcrumb for the current path.

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

const HEADER_LINK =
  "text-xs text-muted-foreground hover:text-foreground hover:underline";

// "Blame" (files only) and "Open in Azure DevOps" links at the right of the
// breadcrumb row.
export function HeaderLinks({
  showBlame,
  onBlame,
  onOpenWeb,
}: {
  showBlame: boolean;
  onBlame: () => void;
  onOpenWeb: () => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-3">
      {showBlame ? (
        <button
          type="button"
          onClick={onBlame}
          className={HEADER_LINK}
          title="Open Blame in Azure DevOps (no public REST blame API)"
        >
          Blame
        </button>
      ) : null}
      <button type="button" onClick={onOpenWeb} className={HEADER_LINK} title="Open in Azure DevOps">
        Open in Azure DevOps
      </button>
    </div>
  );
}
