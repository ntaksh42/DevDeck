import { type FormEvent, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { FileCode, Loader2, Search } from "lucide-react";
import {
  commandErrorMessage,
  searchCode,
  type CodeSearchHit,
  type Organization,
} from "@/lib/azdoCommands";
import { openExternalUrl } from "@/lib/openExternal";
import { ErrorState } from "@/components/StateDisplay";

export function CodeSearchView({ organizations }: { organizations: Organization[] }) {
  const [organizationId, setOrganizationId] = useState(() => organizations[0]?.id ?? "");
  const [query, setQuery] = useState("");
  const [project, setProject] = useState("");

  const selectedOrganizationId = organizationId || organizations[0]?.id || "";
  const mutation = useMutation({ mutationFn: searchCode });
  const results = mutation.data?.results ?? [];

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!query.trim()) return;
    mutation.mutate({
      organizationId: selectedOrganizationId,
      query: query.trim(),
      project: project.trim() || undefined,
    });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="shrink-0 rounded-md border border-border bg-white">
        <form
          className="grid gap-3 p-3 xl:grid-cols-[minmax(240px,1fr)_180px_180px_auto]"
          onSubmit={onSubmit}
        >
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
                onChange={(event) => setOrganizationId(event.target.value)}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
              >
                {organizations.map((org) => (
                  <option key={org.id} value={org.id}>
                    {org.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <label className="grid gap-2">
            <span className="text-sm font-medium">Project</span>
            <input
              value={project}
              onChange={(event) => setProject(event.target.value)}
              placeholder="optional project name"
              className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
          </label>

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
        </form>
      </div>

      {mutation.isError ? <ErrorState message={commandErrorMessage(mutation.error)} /> : null}

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-border bg-white">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <h2 className="text-base font-semibold">Code results</h2>
          <span className="text-sm text-muted-foreground">
            {mutation.isPending
              ? "Searching"
              : mutation.isSuccess
                ? `${mutation.data.count} match${mutation.data.count === 1 ? "" : "es"}`
                : "Ready"}
          </span>
        </div>
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
              <CodeResultRow key={`${hit.repositoryName}:${hit.path}`} hit={hit} />
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
