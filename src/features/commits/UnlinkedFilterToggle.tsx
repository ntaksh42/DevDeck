// Header toggle for the "Unlinked only" commit filter (no AB# mention, no PR).
export function UnlinkedFilterToggle({
  enabled,
  pending,
  onToggle,
}: {
  enabled: boolean;
  pending: number;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={enabled}
      onClick={onToggle}
      title="Show only commits with no work item (AB#) mention that are not in any pull request"
      className={`flex h-4 items-center rounded border px-1.5 text-[11px] hover:bg-secondary ${
        enabled ? "border-primary bg-secondary text-foreground" : "border-border bg-card"
      }`}
    >
      {enabled && pending > 0 ? `Unlinked (checking ${pending}…)` : "Unlinked"}
    </button>
  );
}
