import { type FormEvent, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { FileCode, Info, Loader2, Search } from "lucide-react";
import {
  commandErrorMessage,
  listCommitRepositories,
  searchCode,
  type CodeSearchHit,
  type Organization,
} from "@/lib/azdoCommands";
import { openExternalUrl } from "@/lib/openExternal";
import { ErrorState } from "@/components/StateDisplay";

const SELECT_CLASS =
  "h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60";
const INPUT_CLASS =
  "h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring";

export function CodeSearchView({ organizations }: { organizations: Organization[] }) {
  const [organizationId, setOrganizationId] = useState(() => organizations[0]?.id ?? "");
  const [query, setQuery] = useState("");
  const [projectId, setProjectId] = useState("");
  const [repositoryId, setRepositoryId] = useState("");
  const [branch, setBranch] = useState("");
  const [path, setPath] = useState("");

  const selectedOrganizationId = organizationId || organizations[0]?.id || "";
  const mutation = useMutation({ mutationFn: searchCode });
  const results = mutation.data?.results ?? [];

  // Reuse the synced repository list (also used by Commit search) to populate
  // the project/repository pickers.
  const repositoriesQuery = useQuery({
    queryKey: ["commitRepositories", selectedOrganizationId],
    queryFn: () => listCommitRepositories({ organizationId: selectedOrganizationId }),
    enabled: !!selectedOrganizationId,
    staleTime: 5 * 60_000,
  });
  const repositoryOptions = repositoriesQuery.data ?? [];

  const projectOptions = useMemo(() => {
    const map = new Map<string, { projectId: string; projectName: string }>();
    for (const repo of repositoryOptions) {
      map.set(repo.projectId, { projectId: repo.projectId, projectName: repo.projectName });
    }
    return [...map.values()].sort((a, b) => a.projectName.localeCompare(b.projectName));
  }, [repositoryOptions]);

  const filteredRepositories = useMemo(
    () =>
      projectId
        ? repositoryOptions.filter((repo) => repo.projectId === projectId)
        : repositoryOptions,
    [projectId, repositoryOptions],
  );

  useEffect(() => {
    if (
      repositoryId &&
      !filteredRepositories.some((repo) => repo.repositoryId === repositoryId)
    ) {
      setRepositoryId("");
    }
  }, [filteredRepositories, repositoryId]);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!query.trim()) return;
    const repo = repositoryOptions.find((option) => option.repositoryId === repositoryId);
    const project = projectOptions.find((option) => option.projectId === projectId);
    mutation.mutate({
      organizationId: selectedOrganizationId,
      query: query.trim(),
      // A selected repository carries its own project, so prefer that.
      project: repo?.projectName ?? project?.projectName ?? undefined,
      repository: repo?.repositoryName ?? undefined,
      branch: branch.trim() || undefined,
      path: path.trim() || undefined,
    });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="shrink-0 rounded-md border border-border bg-card">
        <form className="grid gap-3 p-3" onSubmit={onSubmit}>
          <div className="grid gap-3 xl:grid-cols-[minmax(240px,1fr)_180px_auto]">
            <label className="grid gap-2">
              <span className="text-sm font-medium">Search code</span>
              <div className="flex h-9 items-center rounded-md border border-input bg-background px-3 focus-within:ring-2 focus-within:ring-ring">
                <Search className="mr-2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="text, symbol, or filename"
                  autoFocus
                  className="min-w-0 flex-1 bg-transparent text-sm outline-none"
                />
              </div>
            </label>

            {organizations.length > 1 ? (
              <label className="grid gap-2">
                <span className="text-sm font-medium">Organization</span>
                <select
                  value={selectedOrganizationId}
                  onChange={(event) => {
                    setOrganizationId(event.target.value);
                    setProjectId("");
                    setRepositoryId("");
                  }}
                  className={SELECT_CLASS}
                >
                  {organizations.map((org) => (
                    <option key={org.id} value={org.id}>
                      {org.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            <div className="flex items-end">
              <button
                type="submit"
                disabled={mutation.isPending || !selectedOrganizationId || !query.trim()}
                className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60 lg:w-auto"
              >
                {mutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Search className="h-4 w-4" aria-hidden="true" />
                )}
                Search
              </button>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <label className="grid gap-2">
              <span className="text-sm font-medium">Project</span>
              <select
                value={projectId}
                disabled={repositoriesQuery.isLoading || projectOptions.length === 0}
                onChange={(event) => {
                  setProjectId(event.target.value);
                  setRepositoryId("");
                }}
                className={SELECT_CLASS}
              >
                <option value="">All projects</option>
                {projectOptions.map((project) => (
                  <option key={project.projectId} value={project.projectId}>
                    {project.projectName}
                  </option>
                ))}
              </select>
            </label>

            <label className="grid gap-2">
              <span className="text-sm font-medium">Repository</span>
              <select
                value={repositoryId}
                disabled={repositoriesQuery.isLoading || filteredRepositories.length === 0}
                onChange={(event) => setRepositoryId(event.target.value)}
                className={SELECT_CLASS}
              >
                <option value="">All repositories</option>
                {filteredRepositories.map((repo) => (
                  <option
                    key={`${repo.projectId}:${repo.repositoryId}`}
                    value={repo.repositoryId}
                  >
                    {projectId
                      ? repo.repositoryName
                      : `${repo.projectName} / ${repo.repositoryName}`}
                  </option>
                ))}
              </select>
            </label>

            <label className="grid gap-2">
              <span className="text-sm font-medium">Branch</span>
              <input
                value={branch}
                onChange={(event) => setBranch(event.target.value)}
                placeholder="main"
                className={INPUT_CLASS}
              />
            </label>

            <label className="grid gap-2">
              <span className="text-sm font-medium">Path</span>
              <input
                value={path}
                onChange={(event) => setPath(event.target.value)}
                placeholder="/src"
                className={INPUT_CLASS}
              />
            </label>
          </div>
        </form>
      </div>

      {mutation.isError ? <ErrorState message={commandErrorMessage(mutation.error)} /> : null}

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <h2 className="text-base font-semibold">Code results</h2>
          <span className="text-sm text-muted-foreground">
            {mutation.isPending
              ? "Searching"
              : mutation.isSuccess
                ? mutation.data.count > results.length
                  ? `Showing ${results.length} of ${mutation.data.count} matches`
                  : `${mutation.data.count} match${mutation.data.count === 1 ? "" : "es"}`
                : "Ready"}
          </span>
        </div>

        {mutation.data?.notice ? (
          <p className="flex items-start gap-1.5 border-b border-border bg-yellow-50 px-3 py-2 text-xs text-yellow-800 dark:bg-yellow-950/40 dark:text-yellow-300">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {mutation.data.notice}
          </p>
        ) : null}

        {!mutation.isSuccess && !mutation.isPending ? (
          <div className="px-3 py-6 text-center text-sm text-muted-foreground">
            Search code across the organization's repositories.
          </div>
        ) : results.length === 0 && !mutation.isPending ? (
          <div className="px-3 py-6 text-center text-sm text-muted-foreground">
            No code matched.
          </div>
        ) : (
          <ul className="min-h-0 flex-1 overflow-y-auto">
            {results.map((hit) => (
              <CodeResultRow
                key={`${hit.projectName}:${hit.repositoryName}:${hit.branch ?? ""}:${hit.path}`}
                hit={hit}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function CodeResultRow({ hit }: { hit: CodeSearchHit }) {
  return (
    <li>
      <button
        type="button"
        onClick={() => openExternalUrl(hit.webUrl)}
        className="flex w-full items-center gap-2 border-b border-border px-3 py-1.5 text-left text-sm hover:bg-muted/50"
        title={`${hit.path} — open in Azure DevOps`}
      >
        <FileCode className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="shrink-0 font-medium">{hit.fileName}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
          {hit.path}
        </span>
        <span className="shrink-0 text-xs text-muted-foreground">
          {hit.projectName} / {hit.repositoryName}
          {hit.branch ? ` · ${hit.branch}` : ""}
        </span>
      </button>
    </li>
  );
}
