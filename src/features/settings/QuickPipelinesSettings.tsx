import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import {
  commandErrorMessage,
  listPipelineDefinitions,
  listPipelineProjects,
  type Organization,
} from '@/lib/azdoCommands';
import { FilterableSelect, type SelectOption } from "@/features/pipelines/FilterableSelect";
import {
  DEFAULT_QUICK_PIPELINE_BRANCH,
  addQuickPipeline,
  loadQuickPipelines,
  removeQuickPipeline,
  saveQuickPipelines,
  type QuickPipeline,
} from "@/features/pipelines/quickPipelinesStorage";
import { emitQuickPipelinesChanged } from "@/features/pipelines/quickPipelinesEvents";
import { SettingsRow } from './SettingsRow';

export function QuickPipelinesSettings({ organizations }: { organizations: Organization[] }) {
  const [pipelines, setPipelines] = useState<QuickPipeline[]>(() => loadQuickPipelines());
  const [organizationId, setOrganizationId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [definitionId, setDefinitionId] = useState("");
  const [name, setName] = useState("");
  const [branch, setBranch] = useState(DEFAULT_QUICK_PIPELINE_BRANCH);
  const [formError, setFormError] = useState<string | null>(null);

  // Default the org picker to the first organization once they load.
  useEffect(() => {
    if (!organizationId && organizations.length > 0) {
      setOrganizationId(organizations[0].id);
    }
  }, [organizations, organizationId]);

  const projectsQuery = useQuery({
    queryKey: ["pipelineProjects", organizationId],
    queryFn: () => listPipelineProjects({ organizationId }),
    enabled: !!organizationId,
    staleTime: 5 * 60_000,
  });

  const definitionsQuery = useQuery({
    queryKey: ["pipelineDefinitions", organizationId, projectId],
    queryFn: () => listPipelineDefinitions({ organizationId, projectId }),
    enabled: !!organizationId && !!projectId,
    staleTime: 5 * 60_000,
  });

  const projectOptions = useMemo<SelectOption[]>(
    () => (projectsQuery.data ?? []).map((p) => ({ value: p.id, label: p.name })),
    [projectsQuery.data],
  );
  const definitionOptions = useMemo<SelectOption[]>(
    () => (definitionsQuery.data ?? []).map((d) => ({ value: String(d.id), label: d.name })),
    [definitionsQuery.data],
  );

  function persist(next: QuickPipeline[]) {
    setPipelines(next);
    saveQuickPipelines(next);
    emitQuickPipelinesChanged();
  }

  function onAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    const project = projectsQuery.data?.find((p) => p.id === projectId);
    const definition = definitionsQuery.data?.find((d) => String(d.id) === definitionId);
    if (!organizationId || !project || !definition) {
      setFormError("Select an organization, project, and pipeline.");
      return;
    }
    if (!branch.trim()) {
      setFormError("A source branch is required.");
      return;
    }
    const next = addQuickPipeline(pipelines, {
      name: name.trim() || definition.name,
      organizationId,
      projectId: project.id,
      projectName: project.name,
      definitionId: definition.id,
      definitionName: definition.name,
      sourceBranch: branch.trim(),
    });
    persist(next);
    setName("");
    setBranch(DEFAULT_QUICK_PIPELINE_BRANCH);
    setDefinitionId("");
  }

  function onRemove(id: string) {
    persist(removeQuickPipeline(pipelines, id));
  }

  const orgName = (id: string) => organizations.find((org) => org.id === id)?.name ?? id;

  return (
    <SettingsRow
      title="Quick Pipelines"
      description={<>Register pipelines to run them from the command palette (Ctrl+K).</>}
    >
      <form className="grid gap-3" onSubmit={onAdd}>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="grid gap-1.5">
            <span className="text-sm font-medium">Organization</span>
            <FilterableSelect
              ariaLabel="Quick pipeline organization"
              value={organizationId}
              options={organizations.map((org) => ({ value: org.id, label: org.name }))}
              onChange={(value) => {
                setOrganizationId(value);
                setProjectId("");
                setDefinitionId("");
              }}
              placeholder="Select organization"
            />
          </label>
          <label className="grid gap-1.5">
            <span className="text-sm font-medium">Project</span>
            <FilterableSelect
              ariaLabel="Quick pipeline project"
              value={projectId}
              options={projectOptions}
              disabled={!organizationId || projectsQuery.isLoading}
              onChange={(value) => {
                setProjectId(value);
                setDefinitionId("");
              }}
              placeholder={projectsQuery.isLoading ? "Loading projects…" : "Select project"}
            />
          </label>
          <label className="grid gap-1.5">
            <span className="text-sm font-medium">Pipeline</span>
            <FilterableSelect
              ariaLabel="Quick pipeline definition"
              value={definitionId}
              options={definitionOptions}
              disabled={!projectId || definitionsQuery.isLoading}
              onChange={setDefinitionId}
              placeholder={definitionsQuery.isLoading ? "Loading pipelines…" : "Select pipeline"}
            />
          </label>
          <label className="grid gap-1.5">
            <span className="text-sm font-medium">Source branch</span>
            <input
              value={branch}
              onChange={(event) => setBranch(event.target.value)}
              placeholder={DEFAULT_QUICK_PIPELINE_BRANCH}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
          </label>
          <label className="grid gap-1.5 md:col-span-2">
            <span className="text-sm font-medium">Display name</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Defaults to the pipeline name"
              className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
          </label>
        </div>

        {projectsQuery.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {commandErrorMessage(projectsQuery.error)}
          </p>
        ) : null}
        {definitionsQuery.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {commandErrorMessage(definitionsQuery.error)}
          </p>
        ) : null}
        {formError ? (
          <p role="alert" className="text-sm text-destructive">
            {formError}
          </p>
        ) : null}

        <div>
          <button
            type="submit"
            disabled={!definitionId}
            className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add pipeline
          </button>
        </div>
      </form>

      {pipelines.length > 0 ? (
        <div className="divide-y divide-border border-t border-border">
          {pipelines.map((pipeline) => (
            <div
              key={pipeline.id}
              className="grid items-center gap-3 px-3 py-2 md:grid-cols-[1fr_auto]"
            >
              <div className="min-w-0">
                <p className="truncate font-medium">{pipeline.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {orgName(pipeline.organizationId)} / {pipeline.projectName} /{" "}
                  {pipeline.definitionName} · {shortQuickBranch(pipeline.sourceBranch)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => onRemove(pipeline.id)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                aria-label={`Remove ${pipeline.name}`}
                title={`Remove ${pipeline.name}`}
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </SettingsRow>
  );
}

function shortQuickBranch(branch: string): string {
  return branch.replace(/^refs\/heads\//, "");
}
