import { useQuery } from "@tanstack/react-query";
import {
  commandErrorMessage,
  getPipelineDefinition,
  type PipelineTrigger,
  type PipelineVariable,
} from "@/lib/azdoCommands";

const TRIGGER_LABELS: Record<string, string> = {
  continuousIntegration: "Continuous integration",
  pullRequest: "Pull request",
  schedule: "Scheduled",
  gatedCheckIn: "Gated check-in",
  buildCompletion: "Build completion",
  none: "Manual only",
};

function triggerLabel(triggerType: string | null): string {
  if (!triggerType) return "Trigger";
  return TRIGGER_LABELS[triggerType] ?? triggerType;
}

function FilterList({ label, filters }: { label: string; filters: string[] }) {
  if (filters.length === 0) return null;
  return (
    <div className="flex flex-wrap items-baseline gap-1.5">
      <span className="text-muted-foreground">{label}</span>
      {filters.map((filter) => (
        <code
          key={filter}
          className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]"
        >
          {filter}
        </code>
      ))}
    </div>
  );
}

function TriggerCard({ trigger }: { trigger: PipelineTrigger }) {
  const hasFilters =
    trigger.branchFilters.length > 0 || trigger.pathFilters.length > 0;
  return (
    <div className="rounded-md border border-border p-2.5">
      <div className="text-xs font-medium">{triggerLabel(trigger.triggerType)}</div>
      {hasFilters && (
        <div className="mt-1.5 flex flex-col gap-1 text-[11px]">
          <FilterList label="Branches" filters={trigger.branchFilters} />
          <FilterList label="Paths" filters={trigger.pathFilters} />
        </div>
      )}
    </div>
  );
}

function VariableRow({ variable }: { variable: PipelineVariable }) {
  return (
    <tr className="border-b border-border/50 last:border-0">
      <td className="py-1 pr-3 align-top font-medium">{variable.name}</td>
      <td className="py-1 pr-3 align-top font-mono text-[11px]">
        {variable.isSecret ? (
          <span className="text-muted-foreground">••••••</span>
        ) : (
          variable.value ?? "—"
        )}
      </td>
      <td className="py-1 align-top">
        <div className="flex flex-wrap gap-1">
          {variable.isSecret && (
            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
              Secret
            </span>
          )}
          {variable.allowOverride && (
            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
              Overridable
            </span>
          )}
        </div>
      </td>
    </tr>
  );
}

export function PipelineDefinitionPanel({
  organizationId,
  projectId,
  definitionId,
  definitionName,
}: {
  organizationId: string;
  projectId: string;
  definitionId: number;
  definitionName: string;
}) {
  const definitionQuery = useQuery({
    queryKey: ["pipelineDefinition", organizationId, projectId, definitionId],
    queryFn: () => getPipelineDefinition({ organizationId, projectId, definitionId }),
    staleTime: 5 * 60_000,
  });

  const detail = definitionQuery.data;

  return (
    <aside className="flex min-h-0 flex-col overflow-hidden rounded-md border border-border bg-card">
      <div className="border-b border-border p-3">
        <h2 className="truncate text-sm font-semibold" title={definitionName}>
          {definitionName}
        </h2>
        <p className="truncate text-xs text-muted-foreground">Pipeline definition</p>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-3">
        {definitionQuery.isLoading && (
          <p className="text-xs text-muted-foreground">Loading definition…</p>
        )}
        {definitionQuery.isError && (
          <p className="text-xs text-destructive">
            {commandErrorMessage(definitionQuery.error)}
          </p>
        )}
        {detail && (
          <>
            <section className="flex flex-col gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Triggers
              </h3>
              {detail.triggers.length === 0 ? (
                <p className="text-xs text-muted-foreground">No triggers configured.</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {detail.triggers.map((trigger, index) => (
                    <TriggerCard
                      key={`${trigger.triggerType ?? "trigger"}-${index}`}
                      trigger={trigger}
                    />
                  ))}
                </div>
              )}
            </section>

            <section className="flex flex-col gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Variables
              </h3>
              {detail.variables.length === 0 ? (
                <p className="text-xs text-muted-foreground">No variables defined.</p>
              ) : (
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-border text-[10px] uppercase tracking-wide text-muted-foreground">
                      <th className="py-1 pr-3 font-medium">Name</th>
                      <th className="py-1 pr-3 font-medium">Value</th>
                      <th className="py-1 font-medium">Flags</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.variables.map((variable) => (
                      <VariableRow key={variable.name} variable={variable} />
                    ))}
                  </tbody>
                </table>
              )}
            </section>

            <p className="mt-auto text-[11px] text-muted-foreground">
              YAML パイプラインでは一部のトリガー・変数がここに表示されないことがあります。
            </p>
          </>
        )}
      </div>
    </aside>
  );
}
