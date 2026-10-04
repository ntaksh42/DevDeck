import { Plus } from "lucide-react";
import { MAX_SUBSCRIPTIONS } from "./pipelineSubscriptionsStorage";

// Empty board: instead of only telling the user to Watch something, offer the
// selected project's pipelines as one-click candidates.
export function PipelineWatchSuggestions({
  projectName,
  definitions,
  onWatch,
  onWatchAll,
}: {
  projectName: string | null;
  definitions: { id: number; name: string }[];
  onWatch: (definitionId: number) => void;
  onWatchAll: () => void;
}) {
  const shown = definitions.slice(0, 12);
  return (
    <div className="flex h-full flex-col items-center justify-center rounded-md border border-dashed border-border bg-card px-6 py-10 text-center">
      <p className="text-sm font-medium">No watched pipelines yet</p>
      {shown.length > 0 ? (
        <>
          <p className="mt-1 text-sm text-muted-foreground">
            Watch pipelines to track their run history here
            {projectName ? (
              <>
                {" "}
                — <span className="font-medium">{projectName}</span>:
              </>
            ) : (
              "."
            )}
          </p>
          <div className="mt-3 flex max-w-xl flex-wrap justify-center gap-1.5">
            {shown.map((definition) => (
              <button
                key={definition.id}
                type="button"
                onClick={() => onWatch(definition.id)}
                className="inline-flex h-7 items-center gap-1 rounded-full border border-border bg-background px-2.5 text-xs hover:bg-accent focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <Plus className="h-3 w-3" aria-hidden="true" />
                {definition.name}
              </button>
            ))}
            {definitions.length > 1 ? (
              <button
                type="button"
                onClick={onWatchAll}
                title={definitions.length > MAX_SUBSCRIPTIONS ? `Watches the first ${MAX_SUBSCRIPTIONS}` : undefined}
                className="inline-flex h-7 items-center rounded-full border border-primary px-2.5 text-xs font-medium text-primary hover:bg-primary/10 focus:outline-none focus:ring-2 focus:ring-ring"
              >
                Watch all ({Math.min(definitions.length, MAX_SUBSCRIPTIONS)})
              </button>
            ) : null}
          </div>
        </>
      ) : (
        <p className="mt-1 text-sm text-muted-foreground">
          Pick a project and pipeline above, then press <span className="font-medium">Watch</span> to track its run
          history here.
        </p>
      )}
    </div>
  );
}
