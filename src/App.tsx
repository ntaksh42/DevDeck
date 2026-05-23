import { FormEvent, ReactNode, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Building2,
  Eye,
  EyeOff,
  GitPullRequest,
  Loader2,
  Plus,
  Search,
  Settings,
} from "lucide-react";
import { Route, Routes } from "react-router-dom";
import {
  addPatOrganization,
  commandErrorMessage,
  listOrganizations,
  searchPullRequests,
  type Organization,
  type PullRequestSummary,
  type SearchPullRequestsInput,
} from "@/lib/azdoCommands";

type View = "dashboard" | "settings";

function AppShell() {
  const [view, setView] = useState<View>("dashboard");
  const organizationsQuery = useQuery({
    queryKey: ["organizations"],
    queryFn: listOrganizations,
  });

  const organizations = organizationsQuery.data ?? [];
  const activeView = organizations.length === 0 ? "settings" : view;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <aside className="fixed inset-y-0 left-0 hidden w-64 border-r border-border bg-white lg:block">
        <div className="flex h-16 items-center gap-3 border-b border-border px-5">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Building2 className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <p className="text-sm font-semibold">AzDoDeck</p>
            <p className="text-xs text-muted-foreground">Azure DevOps</p>
          </div>
        </div>
        <nav className="space-y-1 p-3">
          <NavButton
            active={activeView === "dashboard"}
            disabled={organizations.length === 0}
            icon={<GitPullRequest className="h-4 w-4" aria-hidden="true" />}
            label="Pull Requests"
            onClick={() => setView("dashboard")}
          />
          <NavButton
            active={activeView === "settings"}
            icon={<Settings className="h-4 w-4" aria-hidden="true" />}
            label="Settings"
            onClick={() => setView("settings")}
          />
        </nav>
      </aside>

      <main className="lg:pl-64">
        <header className="flex h-16 items-center justify-between border-b border-border bg-white px-5 lg:px-8">
          <div>
            <h1 className="text-lg font-semibold">
              {activeView === "dashboard" ? "Pull Requests" : "Settings"}
            </h1>
            <p className="text-sm text-muted-foreground">
              {activeView === "dashboard"
                ? "Search Azure DevOps pull requests across projects and repositories"
                : "Local Azure DevOps organization setup"}
            </p>
          </div>
        </header>

        <section className="mx-auto max-w-6xl px-5 py-8 lg:px-8">
          {organizationsQuery.isLoading ? (
            <LoadingState />
          ) : organizationsQuery.isError ? (
            <ErrorState message={commandErrorMessage(organizationsQuery.error)} />
          ) : activeView === "dashboard" ? (
            <PullRequestSearch organizations={organizations} />
          ) : organizations.length === 0 ? (
            <SetupPanel />
          ) : (
            <OrganizationSettings organizations={organizations} />
          )}
        </section>
      </main>
    </div>
  );
}

function NavButton({
  active,
  disabled = false,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  disabled?: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`flex h-10 w-full items-center gap-3 rounded-md px-3 text-left text-sm font-medium ${
        active ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-secondary"
      } disabled:cursor-not-allowed disabled:opacity-50`}
    >
      {icon}
      {label}
    </button>
  );
}

function LoadingState() {
  return (
    <div className="flex min-h-64 items-center justify-center text-muted-foreground">
      <Loader2 className="mr-2 h-5 w-5 animate-spin" aria-hidden="true" />
      Loading
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div role="alert" className="rounded-md border border-destructive/30 bg-red-50 p-4">
      <p className="text-sm font-medium text-destructive">{message}</p>
    </div>
  );
}

function PullRequestSearch({
  organizations,
}: {
  organizations: Organization[];
}) {
  const [organizationId, setOrganizationId] = useState(organizations[0]?.id ?? "");
  const [query, setQuery] = useState("");
  const [status, setStatus] =
    useState<SearchPullRequestsInput["status"]>("active");

  const mutation = useMutation({
    mutationFn: searchPullRequests,
  });

  const selectedOrganizationId = organizationId || organizations[0]?.id || "";
  const results = mutation.data ?? [];

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    mutation.mutate({
      organizationId: selectedOrganizationId,
      query,
      status,
    });
  }

  return (
    <div className="space-y-6">
      <div className="rounded-md border border-border bg-white">
        <form className="grid gap-4 p-5" onSubmit={onSubmit}>
          <div className="grid gap-4 lg:grid-cols-[1fr_180px_160px_auto]">
            <label className="grid gap-2">
              <span className="text-sm font-medium">Search</span>
              <div className="flex h-10 items-center rounded-md border border-input bg-background px-3 focus-within:ring-2 focus-within:ring-ring">
                <Search className="mr-2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="title, author, repository, branch"
                  className="min-w-0 flex-1 bg-transparent text-sm outline-none"
                />
              </div>
            </label>

            <label className="grid gap-2">
              <span className="text-sm font-medium">Organization</span>
              <select
                value={selectedOrganizationId}
                onChange={(event) => setOrganizationId(event.target.value)}
                className="h-10 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
              >
                {organizations.map((organization) => (
                  <option key={organization.id} value={organization.id}>
                    {organization.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="grid gap-2">
              <span className="text-sm font-medium">Status</span>
              <select
                value={status}
                onChange={(event) =>
                  setStatus(event.target.value as SearchPullRequestsInput["status"])
                }
                className="h-10 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="active">Active</option>
                <option value="completed">Completed</option>
                <option value="abandoned">Abandoned</option>
                <option value="all">All</option>
              </select>
            </label>

            <div className="flex items-end">
              <button
                type="submit"
                disabled={mutation.isPending || !selectedOrganizationId}
                className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60 lg:w-auto"
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
        </form>
      </div>

      {mutation.isError ? (
        <ErrorState message={commandErrorMessage(mutation.error)} />
      ) : null}

      <PullRequestResults loading={mutation.isPending} results={results} searched={mutation.isSuccess} />
    </div>
  );
}

function PullRequestResults({
  loading,
  results,
  searched,
}: {
  loading: boolean;
  results: PullRequestSummary[];
  searched: boolean;
}) {
  const countLabel = useMemo(() => {
    if (loading) {
      return "Searching";
    }
    if (!searched) {
      return "Ready";
    }
    return `${results.length} pull request${results.length === 1 ? "" : "s"}`;
  }, [loading, results.length, searched]);

  return (
    <div className="overflow-hidden rounded-md border border-border bg-white">
      <div className="flex items-center justify-between border-b border-border px-5 py-4">
        <h2 className="text-base font-semibold">Results</h2>
        <span className="text-sm text-muted-foreground">{countLabel}</span>
      </div>
      {!searched && !loading ? (
        <div className="px-5 py-10 text-center text-sm text-muted-foreground">
          Run a search to load pull requests.
        </div>
      ) : results.length === 0 && !loading ? (
        <div className="px-5 py-10 text-center text-sm text-muted-foreground">
          No pull requests matched.
        </div>
      ) : (
        <div className="divide-y divide-border">
          {results.map((pullRequest) => (
            <PullRequestRow key={`${pullRequest.repositoryId}:${pullRequest.pullRequestId}`} pullRequest={pullRequest} />
          ))}
        </div>
      )}
    </div>
  );
}

function PullRequestRow({
  pullRequest,
}: {
  pullRequest: PullRequestSummary;
}) {
  return (
    <div className="grid gap-3 px-5 py-4 lg:grid-cols-[1fr_auto]">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-md bg-secondary px-2 py-1 text-xs font-medium">
            #{pullRequest.pullRequestId}
          </span>
          <span className="rounded-md border border-border px-2 py-1 text-xs font-medium capitalize">
            {pullRequest.status}
          </span>
          <span className="text-xs text-muted-foreground">
            {formatDate(pullRequest.creationDate)}
          </span>
        </div>
        <p className="mt-2 font-medium">{pullRequest.title}</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {pullRequest.projectName} / {pullRequest.repositoryName}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          {pullRequest.sourceRefName} {"->"} {pullRequest.targetRefName}
        </p>
      </div>
      <div className="text-left text-sm lg:text-right">
        <p className="text-muted-foreground">Created by</p>
        <p className="font-medium">{pullRequest.createdBy ?? "Unknown"}</p>
      </div>
    </div>
  );
}

function OrganizationSettings({
  organizations,
}: {
  organizations: Organization[];
}) {
  return (
    <div className="space-y-6">
      <SetupPanel compact />
      <div className="overflow-hidden rounded-md border border-border bg-white">
        <div className="border-b border-border px-5 py-4">
          <h2 className="text-base font-semibold">Organizations</h2>
        </div>
        <div className="divide-y divide-border">
          {organizations.map((organization) => (
            <div
              key={organization.id}
              className="grid gap-4 px-5 py-4 md:grid-cols-[1fr_auto]"
            >
              <div>
                <p className="font-medium">{organization.name}</p>
                <p className="text-sm text-muted-foreground">
                  {organization.baseUrl}
                </p>
              </div>
              <div className="text-left text-sm md:text-right">
                <p className="text-muted-foreground">Authenticated user</p>
                <p className="font-medium">
                  {organization.authenticatedUserDisplayName ?? "Unknown"}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function SetupPanel({ compact = false }: { compact?: boolean }) {
  const queryClient = useQueryClient();
  const [organization, setOrganization] = useState("");
  const [pat, setPat] = useState("");
  const [showPat, setShowPat] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: addPatOrganization,
    onSuccess: () => {
      setOrganization("");
      setPat("");
      setValidationError(null);
      void queryClient.invalidateQueries({ queryKey: ["organizations"] });
    },
  });

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    mutation.reset();
    if (!organization.trim() || !pat.trim()) {
      setValidationError("Organization and PAT are required.");
      return;
    }
    setValidationError(null);
    mutation.mutate({ organization, pat });
  }

  return (
    <div className="rounded-md border border-border bg-white">
      <div className="border-b border-border px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-secondary">
            <Plus className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-base font-semibold">
              {compact ? "Add organization" : "Connect Azure DevOps"}
            </h2>
            <p className="text-sm text-muted-foreground">
              Credentials are validated before they are saved.
            </p>
          </div>
        </div>
      </div>

      <form className="grid gap-5 p-5" onSubmit={onSubmit}>
        <label className="grid gap-2">
          <span className="text-sm font-medium">Organization</span>
          <input
            value={organization}
            onChange={(event) => setOrganization(event.target.value)}
            placeholder="contoso"
            className="h-10 rounded-md border border-input bg-background px-3 text-sm outline-none ring-offset-background focus:ring-2 focus:ring-ring"
          />
        </label>

        <label className="grid gap-2">
          <span className="text-sm font-medium">Personal access token</span>
          <div className="flex h-10 overflow-hidden rounded-md border border-input bg-background focus-within:ring-2 focus-within:ring-ring">
            <input
              value={pat}
              onChange={(event) => setPat(event.target.value)}
              type={showPat ? "text" : "password"}
              className="min-w-0 flex-1 bg-transparent px-3 text-sm outline-none"
            />
            <button
              type="button"
              onClick={() => setShowPat((value) => !value)}
              className="flex w-10 items-center justify-center border-l border-border text-muted-foreground hover:bg-secondary"
              aria-label={showPat ? "Hide PAT" : "Show PAT"}
            >
              {showPat ? (
                <EyeOff className="h-4 w-4" aria-hidden="true" />
              ) : (
                <Eye className="h-4 w-4" aria-hidden="true" />
              )}
            </button>
          </div>
        </label>

        {validationError ? (
          <p role="alert" className="text-sm text-destructive">
            {validationError}
          </p>
        ) : null}

        {mutation.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {commandErrorMessage(mutation.error)}
          </p>
        ) : null}

        {mutation.isSuccess ? (
          <p className="text-sm text-green-700">Organization connected.</p>
        ) : null}

        <div>
          <button
            type="submit"
            disabled={mutation.isPending}
            className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {mutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Plus className="h-4 w-4" aria-hidden="true" />
            )}
            Connect
          </button>
        </div>
      </form>
    </div>
  );
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function App() {
  return (
    <Routes>
      <Route path="/" element={<AppShell />} />
    </Routes>
  );
}

export default App;
