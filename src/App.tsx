import { FormEvent, ReactNode, forwardRef, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Building2,
  ExternalLink,
  GitCommitHorizontal,
  Eye,
  EyeOff,
  GitPullRequest,
  ListChecks,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Settings,
  X,
} from "lucide-react";
import { Route, Routes } from "react-router-dom";
import {
  addAzureCliOrganization,
  addPatOrganization,
  commandErrorMessage,
  listMyReviewPullRequests,
  listOrganizations,
  searchCommits,
  searchPullRequests,
  searchWorkItems,
  type CommitSummary,
  type Organization,
  type PullRequestSummary,
  type ReviewPullRequestSummary,
  type SearchPullRequestsInput,
  type WorkItemSummary,
} from "@/lib/azdoCommands";
import { openExternalUrl } from "@/lib/openExternal";

type View = "pullRequestSearch" | "myReviews" | "workItems" | "commits" | "settings";

function AppShell() {
  const [view, setView] = useState<View>("pullRequestSearch");
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
          {/* Pull Requests section */}
          <NavSection
            icon={<GitPullRequest className="h-4 w-4" aria-hidden="true" />}
            label="Pull Requests"
            disabled={organizations.length === 0}
          >
            <NavSubItem
              active={activeView === "pullRequestSearch"}
              disabled={organizations.length === 0}
              label="Search"
              onClick={() => setView("pullRequestSearch")}
            />
            <NavSubItem
              active={activeView === "myReviews"}
              disabled={organizations.length === 0}
              label="My Reviews"
              onClick={() => setView("myReviews")}
            />
          </NavSection>
          <NavButton
            active={activeView === "workItems"}
            disabled={organizations.length === 0}
            icon={<ListChecks className="h-4 w-4" aria-hidden="true" />}
            label="Work Items"
            onClick={() => setView("workItems")}
          />
          <NavButton
            active={activeView === "commits"}
            disabled={organizations.length === 0}
            icon={<GitCommitHorizontal className="h-4 w-4" aria-hidden="true" />}
            label="Commits"
            onClick={() => setView("commits")}
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
              {activeView === "pullRequestSearch"
                ? "Pull Requests"
                : activeView === "myReviews"
                  ? "My Reviews"
                  : activeView === "workItems"
                    ? "Work Items"
                    : activeView === "commits"
                      ? "Commits"
                    : "Settings"}
            </h1>
            <p className="text-sm text-muted-foreground">
              {activeView === "pullRequestSearch"
                ? "Search Azure DevOps pull requests across projects and repositories"
                : activeView === "myReviews"
                  ? "Pull requests assigned to you for review"
                  : activeView === "workItems"
                    ? "Search Azure DevOps work items across projects"
                    : activeView === "commits"
                      ? "Search Azure DevOps commits across repositories"
                    : "Local Azure DevOps organization setup"}
            </p>
          </div>
        </header>

        <section className="mx-auto max-w-6xl px-5 py-8 lg:px-8">
          {organizationsQuery.isLoading ? (
            <LoadingState />
          ) : organizationsQuery.isError ? (
            <ErrorState message={commandErrorMessage(organizationsQuery.error)} />
          ) : activeView === "pullRequestSearch" ? (
            <PullRequestSearch organizations={organizations} />
          ) : activeView === "myReviews" ? (
            <MyReviewsGrid organizations={organizations} />
          ) : activeView === "workItems" ? (
            <WorkItemSearch organizations={organizations} />
          ) : activeView === "commits" ? (
            <CommitSearch organizations={organizations} />
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

function CommitSearch({ organizations }: { organizations: Organization[] }) {
  const [organizationId, setOrganizationId] = useState(organizations[0]?.id ?? "");
  const [query, setQuery] = useState("");
  const [author, setAuthor] = useState("");
  const [branch, setBranch] = useState("");

  const mutation = useMutation({
    mutationFn: searchCommits,
  });

  const selectedOrganizationId = organizationId || organizations[0]?.id || "";
  const results = mutation.data ?? [];

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    mutation.mutate({
      organizationId: selectedOrganizationId,
      query,
      author,
      branch,
    });
  }

  return (
    <div className="space-y-6">
      <div className="rounded-md border border-border bg-white">
        <form className="grid gap-4 p-5" onSubmit={onSubmit}>
          <div className="grid gap-4 lg:grid-cols-[1fr_180px_170px_160px_auto]">
            <label className="grid gap-2">
              <span className="text-sm font-medium">Search</span>
              <div className="flex h-10 items-center rounded-md border border-input bg-background px-3 focus-within:ring-2 focus-within:ring-ring">
                <Search className="mr-2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="message, author, repository, SHA"
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
              <span className="text-sm font-medium">Author</span>
              <input
                value={author}
                onChange={(event) => setAuthor(event.target.value)}
                placeholder="email or name"
                className="h-10 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
            </label>

            <label className="grid gap-2">
              <span className="text-sm font-medium">Branch</span>
              <input
                value={branch}
                onChange={(event) => setBranch(event.target.value)}
                placeholder="main"
                className="h-10 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
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

      <CommitResults loading={mutation.isPending} results={results} searched={mutation.isSuccess} />
    </div>
  );
}

function CommitResults({
  loading,
  results,
  searched,
}: {
  loading: boolean;
  results: CommitSummary[];
  searched: boolean;
}) {
  const countLabel = useMemo(() => {
    if (loading) {
      return "Searching";
    }
    if (!searched) {
      return "Ready";
    }
    return `${results.length} commit${results.length === 1 ? "" : "s"}`;
  }, [loading, results.length, searched]);

  return (
    <div className="overflow-hidden rounded-md border border-border bg-white">
      <div className="flex items-center justify-between border-b border-border px-5 py-4">
        <h2 className="text-base font-semibold">Results</h2>
        <span className="text-sm text-muted-foreground">{countLabel}</span>
      </div>
      {!searched && !loading ? (
        <div className="px-5 py-10 text-center text-sm text-muted-foreground">
          Run a search to load commits.
        </div>
      ) : results.length === 0 && !loading ? (
        <div className="px-5 py-10 text-center text-sm text-muted-foreground">
          No commits matched.
        </div>
      ) : (
        <div className="divide-y divide-border">
          {results.map((commit) => (
            <CommitRow key={`${commit.repositoryId}:${commit.commitId}`} commit={commit} />
          ))}
        </div>
      )}
    </div>
  );
}

function CommitRow({ commit }: { commit: CommitSummary }) {
  return (
    <div className="grid gap-3 px-5 py-4 lg:grid-cols-[1fr_auto]">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-md bg-secondary px-2 py-1 font-mono text-xs font-medium">
            {commit.shortCommitId}
          </span>
          {commit.authorDate ? (
            <span className="text-xs text-muted-foreground">
              {formatDate(commit.authorDate)}
            </span>
          ) : null}
        </div>
        <p className="mt-2 font-medium">{commit.comment}</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {commit.projectName} / {commit.repositoryName}
        </p>
      </div>
      <div className="text-left text-sm lg:text-right">
        <p className="text-muted-foreground">Author</p>
        <p className="font-medium">{commit.authorName ?? "Unknown"}</p>
        {commit.authorEmail ? (
          <p className="text-muted-foreground">{commit.authorEmail}</p>
        ) : null}
        <OpenInAzureDevOpsButton url={commit.webUrl} />
      </div>
    </div>
  );
}

function WorkItemSearch({ organizations }: { organizations: Organization[] }) {
  const [organizationId, setOrganizationId] = useState(organizations[0]?.id ?? "");
  const [query, setQuery] = useState("");
  const [state, setState] = useState("all");
  const [workItemType, setWorkItemType] = useState("");

  const mutation = useMutation({
    mutationFn: searchWorkItems,
  });

  const selectedOrganizationId = organizationId || organizations[0]?.id || "";
  const results = mutation.data ?? [];

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    mutation.mutate({
      organizationId: selectedOrganizationId,
      query,
      state,
      workItemType,
    });
  }

  return (
    <div className="space-y-6">
      <div className="rounded-md border border-border bg-white">
        <form className="grid gap-4 p-5" onSubmit={onSubmit}>
          <div className="grid gap-4 lg:grid-cols-[1fr_180px_150px_160px_auto]">
            <label className="grid gap-2">
              <span className="text-sm font-medium">Search</span>
              <div className="flex h-10 items-center rounded-md border border-input bg-background px-3 focus-within:ring-2 focus-within:ring-ring">
                <Search className="mr-2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="title text"
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
              <span className="text-sm font-medium">State</span>
              <select
                value={state}
                onChange={(event) => setState(event.target.value)}
                className="h-10 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="all">All</option>
                <option value="New">New</option>
                <option value="Active">Active</option>
                <option value="Resolved">Resolved</option>
                <option value="Closed">Closed</option>
              </select>
            </label>

            <label className="grid gap-2">
              <span className="text-sm font-medium">Type</span>
              <input
                value={workItemType}
                onChange={(event) => setWorkItemType(event.target.value)}
                placeholder="Bug, Task"
                className="h-10 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
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

      <WorkItemResults loading={mutation.isPending} results={results} searched={mutation.isSuccess} />
    </div>
  );
}

function WorkItemResults({
  loading,
  results,
  searched,
}: {
  loading: boolean;
  results: WorkItemSummary[];
  searched: boolean;
}) {
  const countLabel = useMemo(() => {
    if (loading) {
      return "Searching";
    }
    if (!searched) {
      return "Ready";
    }
    return `${results.length} work item${results.length === 1 ? "" : "s"}`;
  }, [loading, results.length, searched]);

  return (
    <div className="overflow-hidden rounded-md border border-border bg-white">
      <div className="flex items-center justify-between border-b border-border px-5 py-4">
        <h2 className="text-base font-semibold">Results</h2>
        <span className="text-sm text-muted-foreground">{countLabel}</span>
      </div>
      {!searched && !loading ? (
        <div className="px-5 py-10 text-center text-sm text-muted-foreground">
          Run a search to load work items.
        </div>
      ) : results.length === 0 && !loading ? (
        <div className="px-5 py-10 text-center text-sm text-muted-foreground">
          No work items matched.
        </div>
      ) : (
        <div className="divide-y divide-border">
          {results.map((workItem) => (
            <WorkItemRow key={`${workItem.projectId}:${workItem.id}`} workItem={workItem} />
          ))}
        </div>
      )}
    </div>
  );
}

function WorkItemRow({ workItem }: { workItem: WorkItemSummary }) {
  return (
    <div className="grid gap-3 px-5 py-4 lg:grid-cols-[1fr_auto]">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-md bg-secondary px-2 py-1 text-xs font-medium">
            #{workItem.id}
          </span>
          {workItem.workItemType ? (
            <span className="rounded-md border border-border px-2 py-1 text-xs font-medium">
              {workItem.workItemType}
            </span>
          ) : null}
          {workItem.state ? (
            <span className="rounded-md border border-border px-2 py-1 text-xs font-medium">
              {workItem.state}
            </span>
          ) : null}
          {workItem.changedDate ? (
            <span className="text-xs text-muted-foreground">
              {formatDate(workItem.changedDate)}
            </span>
          ) : null}
        </div>
        <p className="mt-2 font-medium">{workItem.title}</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {workItem.projectName}
        </p>
      </div>
      <div className="text-left text-sm lg:text-right">
        <p className="text-muted-foreground">Assigned to</p>
        <p className="font-medium">{workItem.assignedTo ?? "Unassigned"}</p>
        <OpenInAzureDevOpsButton url={workItem.webUrl} />
      </div>
    </div>
  );
}

function formatRelativeDate(isoString: string): string {
  const now = Date.now();
  const then = new Date(isoString).getTime();
  const diffMs = now - then;
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 60) return mins <= 1 ? "just now" : `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

type VoteValue = -10 | -5 | 0 | 5 | 10 | number;

function VoteBadge({ vote, label }: { vote: VoteValue; label: string }) {
  const colors: Record<number, string> = {
    10: "bg-green-100 text-green-800 border-green-200",
    5: "bg-teal-100 text-teal-800 border-teal-200",
    0: "bg-gray-100 text-gray-600 border-gray-200",
    [-5]: "bg-yellow-100 text-yellow-800 border-yellow-200",
    [-10]: "bg-red-100 text-red-800 border-red-200",
  };
  const cls = colors[vote] ?? "bg-gray-100 text-gray-600 border-gray-200";
  return (
    <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-xs font-medium ${cls}`}>
      {label}
    </span>
  );
}

function RequiredBadge({ required }: { required: boolean }) {
  return required ? (
    <span className="inline-flex items-center rounded border border-blue-200 bg-blue-100 px-1.5 py-0.5 text-xs font-medium text-blue-800">
      Required
    </span>
  ) : (
    <span className="inline-flex items-center rounded border border-gray-200 bg-gray-100 px-1.5 py-0.5 text-xs font-medium text-gray-500">
      Optional
    </span>
  );
}

const ReviewPrRow = forwardRef<
  HTMLDivElement,
  {
    pr: ReviewPullRequestSummary;
    selected: boolean;
    onSelect: () => void;
  }
>(({ pr, selected, onSelect }, ref) => {
  const isStale = Math.floor((Date.now() - new Date(pr.creationDate).getTime()) / 86_400_000) >= 3;
  return (
    <div
      ref={ref}
      tabIndex={0}
      role="row"
      aria-selected={selected}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" && pr.webUrl) {
          e.stopPropagation();
          openExternalUrl(pr.webUrl);
        }
      }}
      className={`grid cursor-pointer select-none items-center gap-2 border-b border-border px-2 py-1.5 text-sm outline-none
        focus:ring-2 focus:ring-inset focus:ring-ring
        ${selected && isStale ? "bg-orange-100 dark:bg-orange-900/30"
          : selected ? "bg-secondary"
          : isStale ? "bg-orange-50 dark:bg-orange-950/20 hover:bg-orange-100/70"
          : "hover:bg-muted/50"}`}
      style={{ gridTemplateColumns: "64px minmax(160px,1.5fr) minmax(200px,3fr) 112px 64px 96px 80px 112px" }}
    >
      {/* PR# */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          if (pr.webUrl) openExternalUrl(pr.webUrl);
        }}
        className="truncate text-left font-mono text-xs text-primary hover:underline"
        title={`PR #${pr.pullRequestId}`}
      >
        #{pr.pullRequestId}
      </button>

      {/* Repository */}
      <span className="truncate text-sm text-foreground" title={pr.repositoryName}>
        {pr.repositoryName}
      </span>

      {/* Title + Draft badge */}
      <div className="flex min-w-0 items-center gap-1.5">
        {pr.isDraft && (
          <span className="inline-flex shrink-0 items-center rounded border border-gray-300 bg-gray-50 px-1.5 py-0.5 text-xs text-gray-500">
            Draft
          </span>
        )}
        <span className="truncate font-medium text-foreground" title={pr.title}>
          {pr.title}
        </span>
      </div>

      {/* Author */}
      <span className="truncate text-sm text-muted-foreground" title={pr.createdBy ?? "Unknown"}>
        {pr.createdBy ?? "Unknown"}
      </span>

      {/* Created */}
      <span
        className={`text-xs ${isStale ? "font-medium text-orange-600 dark:text-orange-400" : "text-muted-foreground"}`}
        title={new Date(pr.creationDate).toLocaleString()}
      >
        {formatRelativeDate(pr.creationDate)}
      </span>

      {/* Target branch */}
      <span className="truncate text-xs text-muted-foreground" title={pr.targetRefName}>
        {pr.targetRefName}
      </span>

      {/* Required / Optional */}
      <RequiredBadge required={pr.myIsRequired} />

      {/* Vote */}
      <VoteBadge vote={pr.myVote} label={pr.myVoteLabel} />
    </div>
  );
});
ReviewPrRow.displayName = "ReviewPrRow";

type VoteFilter = "noVote" | "approved" | "rejected" | "all";

function MyReviewsGrid({ organizations }: { organizations: Organization[] }) {
  const organizationId = organizations[0]?.id ?? "";

  const query = useQuery({
    queryKey: ["myReviews", organizationId],
    queryFn: () => listMyReviewPullRequests({ organizationId }),
    enabled: !!organizationId,
  });

  const [textFilter, setTextFilter] = useState("");
  const [voteFilter, setVoteFilter] = useState<VoteFilter>("noVote");
  const [showDrafts, setShowDrafts] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);

  const allPrs = query.data ?? [];

  const filtered = useMemo(() => {
    const lower = textFilter.toLowerCase();
    return allPrs.filter((pr) => {
      if (!showDrafts && pr.isDraft) return false;
      if (
        lower &&
        !pr.repositoryName.toLowerCase().includes(lower) &&
        !pr.title.toLowerCase().includes(lower) &&
        !(pr.createdBy ?? "").toLowerCase().includes(lower)
      )
        return false;
      if (voteFilter === "noVote" && pr.myVote !== 0) return false;
      if (voteFilter === "approved" && pr.myVote !== 10 && pr.myVote !== 5) return false;
      if (voteFilter === "rejected" && pr.myVote !== -10 && pr.myVote !== -5) return false;
      return true;
    });
  }, [allPrs, textFilter, voteFilter, showDrafts]);

  const visiblePrs = allPrs.filter((pr) => showDrafts || !pr.isDraft);
  const noVoteCount = visiblePrs.filter((pr) => pr.myVote === 0).length;
  const isFiltered = !!textFilter || voteFilter !== "all";

  function handleKeyDown(e: React.KeyboardEvent) {
    if (filtered.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      const next = Math.min(selectedIndex + 1, filtered.length - 1);
      setSelectedIndex(next);
      rowRefs.current[next]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const prev = Math.max(selectedIndex - 1, 0);
      setSelectedIndex(prev);
      rowRefs.current[prev]?.focus();
    } else if (e.key === "Enter") {
      const pr = filtered[selectedIndex];
      if (pr?.webUrl) openExternalUrl(pr.webUrl);
    } else if (e.key === "r" || e.key === "R") {
      query.refetch();
    }
  }

  const voteFilterOptions: { value: VoteFilter; label: string }[] = [
    { value: "noVote", label: "No Vote" },
    { value: "approved", label: "Approved" },
    { value: "rejected", label: "Rejected" },
    { value: "all", label: "All" },
  ];

  const COLS = "64px minmax(160px,1.5fr) minmax(200px,3fr) 112px 64px 96px 80px 112px";

  return (
    <div className="space-y-2" onKeyDown={handleKeyDown}>
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-white px-3 py-2">
        {/* Text search */}
        <div className="flex h-8 flex-1 items-center rounded-md border border-input bg-background px-3 focus-within:ring-2 focus-within:ring-ring">
          <Search className="mr-2 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <input
            type="text"
            placeholder="Filter by repo, title, author…"
            value={textFilter}
            onChange={(e) => {
              setTextFilter(e.target.value);
              setSelectedIndex(0);
            }}
            className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          {textFilter && (
            <button
              type="button"
              onClick={() => setTextFilter("")}
              className="ml-1 rounded text-muted-foreground hover:text-foreground"
              aria-label="Clear filter"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Vote filter tabs */}
        <div className="flex items-center gap-0.5 rounded-md border border-border bg-gray-50 p-0.5">
          {voteFilterOptions.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => {
                setVoteFilter(opt.value);
                setSelectedIndex(0);
              }}
              className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                voteFilter === opt.value
                  ? "bg-white text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* Draft checkbox */}
        <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={showDrafts}
            onChange={(e) => {
              setShowDrafts(e.target.checked);
              setSelectedIndex(0);
            }}
            className="h-3.5 w-3.5 rounded border-gray-300"
          />
          Show Drafts
        </label>

        {/* Refresh button */}
        <button
          type="button"
          onClick={() => query.refetch()}
          disabled={query.isFetching}
          className="flex h-8 items-center gap-1.5 rounded-md border border-border bg-white px-2.5 text-xs font-medium text-muted-foreground hover:bg-secondary disabled:opacity-50"
          aria-label="Refresh"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${query.isFetching ? "animate-spin" : ""}`} aria-hidden="true" />
          Refresh
        </button>
      </div>

      {/* Grid */}
      <div className="overflow-hidden rounded-md border border-border bg-white">
        {/* Column headers */}
        <div
          role="row"
          className="grid items-center gap-2 border-b border-border bg-gray-50 px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
          style={{ gridTemplateColumns: COLS }}
        >
          <span>PR#</span>
          <span>Repository</span>
          <span>Title</span>
          <span>Author</span>
          <span>Created</span>
          <span>Target</span>
          <span>Role</span>
          <span>My Vote</span>
        </div>

        {query.isLoading ? (
          <LoadingState />
        ) : query.isError ? (
          <ErrorState message={commandErrorMessage(query.error)} />
        ) : filtered.length === 0 ? (
          <div className="flex min-h-24 items-center justify-center text-sm text-muted-foreground">
            {allPrs.length === 0 ? "No pull requests assigned to you." : "No results match the current filter."}
          </div>
        ) : (
          <div role="grid" aria-label="My review pull requests">
            {filtered.map((pr, i) => (
              <ReviewPrRow
                key={`${pr.organizationId}-${pr.pullRequestId}`}
                ref={(el) => { rowRefs.current[i] = el; }}
                pr={pr}
                selected={i === selectedIndex}
                onSelect={() => setSelectedIndex(i)}
              />
            ))}
          </div>
        )}

        {/* Status bar */}
        <div className="flex items-center justify-between border-t border-border px-2 py-1 text-xs text-muted-foreground">
          <span>
            {visiblePrs.length} 件中{" "}
            <span className="font-medium text-foreground">{noVoteCount}</span> 件が未投票
          </span>
          {isFiltered && <span>フィルタ適用中: {filtered.length} 件表示</span>}
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        ↑↓ navigate · Enter open in browser · R refresh
      </p>
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

function NavSection({
  icon,
  label,
  disabled = false,
  children,
}: {
  icon: ReactNode;
  label: string;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={disabled ? "opacity-50" : ""}>
      <div className="flex h-10 items-center gap-3 px-3 text-sm font-semibold text-foreground">
        {icon}
        {label}
      </div>
      <div className="ml-3 space-y-0.5 border-l border-border pl-4">
        {children}
      </div>
    </div>
  );
}

function NavSubItem({
  active,
  disabled = false,
  label,
  onClick,
}: {
  active: boolean;
  disabled?: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`flex h-8 w-full items-center rounded-md px-2 text-left text-sm ${
        active ? "bg-secondary font-medium text-foreground" : "text-muted-foreground hover:bg-secondary"
      } disabled:cursor-not-allowed disabled:opacity-50`}
    >
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
        <OpenInAzureDevOpsButton url={pullRequest.webUrl} />
      </div>
    </div>
  );
}

function OpenInAzureDevOpsButton({ url }: { url: string | null }) {
  if (!url) {
    return null;
  }

  return (
    <button
      type="button"
      onClick={() => {
        void openExternalUrl(url);
      }}
      className="mt-3 inline-flex h-8 items-center justify-center gap-2 rounded-md border border-border px-3 text-xs font-medium text-foreground hover:bg-secondary"
      aria-label="Open in Azure DevOps"
      title="Open in Azure DevOps"
    >
      <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
      Open
    </button>
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
              className="grid gap-4 px-5 py-4 md:grid-cols-[1fr_auto_auto]"
            >
              <div>
                <p className="font-medium">{organization.name}</p>
                <p className="text-sm text-muted-foreground">
                  {organization.baseUrl}
                </p>
              </div>
              <div className="text-left text-sm md:text-right">
                <p className="text-muted-foreground">Auth</p>
                <p className="font-medium">
                  {formatAuthProvider(organization.authProvider)}
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

  function onOrganizationConnected() {
    setOrganization("");
    setPat("");
    setValidationError(null);
    void queryClient.invalidateQueries({ queryKey: ["organizations"] });
  }

  const patMutation = useMutation({
    mutationFn: addPatOrganization,
    onSuccess: onOrganizationConnected,
  });

  const azureCliMutation = useMutation({
    mutationFn: addAzureCliOrganization,
    onSuccess: onOrganizationConnected,
  });

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    patMutation.reset();
    azureCliMutation.reset();
    if (!organization.trim() || !pat.trim()) {
      setValidationError("Organization and PAT are required.");
      return;
    }
    setValidationError(null);
    patMutation.mutate({ organization, pat });
  }

  function onConnectAzureCli() {
    patMutation.reset();
    azureCliMutation.reset();
    if (!organization.trim()) {
      setValidationError("Organization is required.");
      return;
    }
    setValidationError(null);
    azureCliMutation.mutate({ organization });
  }

  const isConnecting = patMutation.isPending || azureCliMutation.isPending;

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

        {patMutation.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {commandErrorMessage(patMutation.error)}
          </p>
        ) : null}

        {azureCliMutation.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {commandErrorMessage(azureCliMutation.error)}
          </p>
        ) : null}

        {patMutation.isSuccess || azureCliMutation.isSuccess ? (
          <p className="text-sm text-green-700">Organization connected.</p>
        ) : null}

        <div className="flex flex-wrap gap-3">
          <button
            type="submit"
            disabled={isConnecting}
            className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {patMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Plus className="h-4 w-4" aria-hidden="true" />
            )}
            Connect
          </button>
          <button
            type="button"
            disabled={isConnecting}
            onClick={onConnectAzureCli}
            className="inline-flex h-10 items-center gap-2 rounded-md border border-border px-4 text-sm font-medium text-foreground hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-60"
          >
            {azureCliMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Building2 className="h-4 w-4" aria-hidden="true" />
            )}
            Connect with Azure CLI
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

function formatAuthProvider(value: string): string {
  return value === "azure_cli" ? "Azure CLI" : value.toUpperCase();
}

function App() {
  return (
    <Routes>
      <Route path="/" element={<AppShell />} />
    </Routes>
  );
}

export default App;
