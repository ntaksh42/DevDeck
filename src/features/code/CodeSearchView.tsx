import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ChevronRight, FileCode, Info, Loader2, Search, X } from "lucide-react";
import {
  cancelOperation,
  commandErrorMessage,
  getCodeSearchContext,
  listCommitRepositories,
  newOperationId,
  searchCode,
  type CodeSearchHit,
  type CodeSearchResults,
  type Organization,
} from "@/lib/azdoCommands";
import { openExternalUrl } from "@/lib/openExternal";
import { ErrorState } from "@/components/StateDisplay";
import { MultiSelectFilter } from "@/components/MultiSelectFilter";

const SELECT_CLASS =
  "h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60";
const INPUT_CLASS =
  "h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring";

export function CodeSearchView({ organizations }: { organizations: Organization[] }) {
  const [organizationId, setOrganizationId] = useState(() => organizations[0]?.id ?? "");
  const [query, setQuery] = useState("");
  const [projectIds, setProjectIds] = useState<string[]>([]);
  const [repositoryIds, setRepositoryIds] = useState<string[]>([]);
  const [branch, setBranch] = useState("");
  const [path, setPath] = useState("");

  const selectedOrganizationId = organizationId || organizations[0]?.id || "";
  // The last completed result set is kept separate from the in-flight mutation
  // so a cancelled search leaves the previous results on screen.
  const [lastData, setLastData] = useState<CodeSearchResults | null>(null);
  const operationIdRef = useRef<string | null>(null);
  const cancelledRef = useRef(false);
  const mutation = useMutation({
    mutationFn: searchCode,
    onSuccess: (data) => setLastData(data),
  });
  const results = lastData?.results ?? [];

  function cancelSearch() {
    const id = operationIdRef.current;
    if (!id) return;
    cancelledRef.current = true;
    void cancelOperation(id);
  }

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
      projectIds.length > 0
        ? repositoryOptions.filter((repo) => projectIds.includes(repo.projectId))
        : repositoryOptions,
    [projectIds, repositoryOptions],
  );

  // Drop repository selections that no longer belong to the selected projects.
  useEffect(() => {
    const allowed = new Set(filteredRepositories.map((repo) => repo.repositoryId));
    setRepositoryIds((prev) => {
      const next = prev.filter((id) => allowed.has(id));
      return next.length === prev.length ? prev : next;
    });
  }, [filteredRepositories]);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!query.trim()) return;
    const selectedRepos = repositoryOptions.filter((option) =>
      repositoryIds.includes(option.repositoryId),
    );
    const selectedProjectNames = projectOptions
      .filter((option) => projectIds.includes(option.projectId))
      .map((option) => option.projectName);
    // The Code Search API filters by name and ANDs project with repository, so
    // scope to the selected projects plus the projects owning selected repos.
    const projectNames = [
      ...new Set([...selectedProjectNames, ...selectedRepos.map((repo) => repo.projectName)]),
    ];
    const repositoryNames = selectedRepos.map((repo) => repo.repositoryName);
    const operationId = newOperationId();
    operationIdRef.current = operationId;
    cancelledRef.current = false;
    mutation.mutate({
      organizationId: selectedOrganizationId,
      query: query.trim(),
      projects: projectNames.length > 0 ? projectNames : undefined,
      repositories: repositoryNames.length > 0 ? repositoryNames : undefined,
      branch: branch.trim() || undefined,
      path: path.trim() || undefined,
      operationId,
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
                    setProjectIds([]);
                    setRepositoryIds([]);
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

            <div className="flex items-end gap-2">
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
              {mutation.isPending ? (
                <button
                  type="button"
                  onClick={cancelSearch}
                  className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-border px-3 text-sm font-medium hover:bg-secondary"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                  Cancel
                </button>
              ) : null}
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div className="grid gap-2">
              <span className="text-sm font-medium">Project</span>
              <MultiSelectFilter
                options={projectOptions.map((project) => ({
                  value: project.projectId,
                  label: project.projectName,
                }))}
                selected={projectIds}
                onChange={setProjectIds}
                placeholder="All projects"
                ariaLabel="Filter by project"
                searchable
                disabled={repositoriesQuery.isLoading || projectOptions.length === 0}
              />
            </div>

            <div className="grid gap-2">
              <span className="text-sm font-medium">Repository</span>
              <MultiSelectFilter
                options={filteredRepositories.map((repo) => ({
                  value: repo.repositoryId,
                  label:
                    projectIds.length > 0
                      ? repo.repositoryName
                      : `${repo.projectName} / ${repo.repositoryName}`,
                }))}
                selected={repositoryIds}
                onChange={setRepositoryIds}
                placeholder="All repositories"
                ariaLabel="Filter by repository"
                searchable
                disabled={repositoriesQuery.isLoading || filteredRepositories.length === 0}
              />
            </div>

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

      {mutation.isError && !cancelledRef.current ? (
        <ErrorState message={commandErrorMessage(mutation.error)} />
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <h2 className="text-base font-semibold">Code results</h2>
          <span className="text-sm text-muted-foreground">
            {mutation.isPending
              ? "Searching"
              : lastData
                ? lastData.count > results.length
                  ? `Showing ${results.length} of ${lastData.count} matches`
                  : `${lastData.count} match${lastData.count === 1 ? "" : "es"}`
                : "Ready"}
          </span>
        </div>

        {lastData?.notice ? (
          <p className="flex items-start gap-1.5 border-b border-border bg-yellow-50 px-3 py-2 text-xs text-yellow-800 dark:bg-yellow-950/40 dark:text-yellow-300">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {lastData.notice}
          </p>
        ) : null}

        {!lastData && !mutation.isPending ? (
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
                organizationId={selectedOrganizationId}
                query={mutation.variables?.query ?? query}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function CodeResultRow({
  hit,
  organizationId,
  query,
}: {
  hit: CodeSearchHit;
  organizationId: string;
  query: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const contextQuery = useQuery({
    queryKey: [
      "codeContext",
      organizationId,
      hit.projectName,
      hit.repositoryName,
      hit.branch ?? "",
      hit.path,
      query,
    ],
    queryFn: () =>
      getCodeSearchContext({
        organizationId,
        project: hit.projectName,
        repository: hit.repositoryName,
        branch: hit.branch ?? "",
        path: hit.path,
        query,
      }),
    enabled: expanded && !!hit.branch && !!query.trim(),
    staleTime: 60_000,
  });

  return (
    <li className="border-b border-border">
      <div className="flex w-full items-center">
        <button
          type="button"
          onClick={() => setExpanded((open) => !open)}
          disabled={!hit.branch}
          aria-expanded={expanded}
          aria-label={expanded ? "Hide matching lines" : "Show matching lines"}
          title={hit.branch ? "Show matching lines" : "No branch available to preview"}
          className="flex h-8 w-7 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ChevronRight
            className={`h-4 w-4 transition-transform ${expanded ? "rotate-90" : ""}`}
            aria-hidden="true"
          />
        </button>
        <button
          type="button"
          onClick={() => openExternalUrl(hit.webUrl)}
          className="flex min-w-0 flex-1 items-center gap-2 py-1.5 pr-3 text-left text-sm hover:bg-muted/50"
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
      </div>
      {expanded ? (
        <div className="border-t border-border bg-muted/30 px-3 py-2">
          {contextQuery.isLoading ? (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Loading context…
            </div>
          ) : contextQuery.isError ? (
            <p className="text-xs text-destructive">{commandErrorMessage(contextQuery.error)}</p>
          ) : !contextQuery.data || contextQuery.data.blocks.length === 0 ? (
            <p className="text-xs text-muted-foreground">No matching lines found in the file.</p>
          ) : (
            <div className="grid gap-2">
              {contextQuery.data.blocks.map((block, index) => (
                <pre
                  key={index}
                  className="overflow-x-auto rounded border border-border bg-card font-mono text-[11px] leading-4"
                >
                  {block.lines.map((line) => (
                    <div
                      key={line.lineNumber}
                      className={`flex ${line.isMatch ? "bg-amber-100 dark:bg-amber-950/40" : ""}`}
                    >
                      <span className="w-10 shrink-0 select-none px-1 text-right text-muted-foreground">
                        {line.lineNumber}
                      </span>
                      <span className="whitespace-pre px-2">{line.text || " "}</span>
                    </div>
                  ))}
                </pre>
              ))}
              {contextQuery.data.truncated ? (
                <p className="text-[11px] text-muted-foreground">
                  Showing the first matches; more exist in this file.
                </p>
              ) : null}
            </div>
          )}
        </div>
      ) : null}
    </li>
  );
}
