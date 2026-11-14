import { useQueries, useQuery } from "@tanstack/react-query";
import {
  getWorkItemPreview,
  listPullRequestWorkItems,
  prLocator,
  type AgentWorkEntry,
} from "@/lib/azdoCommands";
import { navigateToPullRequest, navigateToWorkItem } from "@/lib/crossLinks";
import { openExternalUrl } from "@/lib/openExternal";
import { workItemQueryKeys } from "@/features/work-items/queryKeys";

/** Linked items shown at most; the item's own preview lists the rest. */
const MAX_LINKS = 10;

type Link = {
  kind: "PR" | "WI";
  id: number;
  title: string;
  relation: string;
  repositoryId?: string | null;
  webUrl: string | null;
};

/** O: the item inside DevDeck. */
export function openEntryInApp(entry: AgentWorkEntry) {
  if (entry.target === "pull-request") {
    navigateToPullRequest({ organizationId: entry.organizationId, repositoryId: entry.scopeId, pullRequestId: entry.id });
  } else {
    navigateToWorkItem({ organizationId: entry.organizationId, workItemId: entry.id });
  }
}

/** Shift+O: the item on Azure DevOps. */
export function openEntryInBrowser(entry: AgentWorkEntry) {
  if (entry.webUrl) void openExternalUrl(entry.webUrl);
}

function openLink(link: Link, organizationId: string) {
  if (link.kind === "WI") navigateToWorkItem({ organizationId, workItemId: link.id });
  else navigateToPullRequest({ organizationId, repositoryId: link.repositoryId ?? null, pullRequestId: link.id });
}

/** Work items linked to a pull request, and the parent, children and pull requests of a work item. */
function useLinks(entry: AgentWorkEntry): { links: Link[]; loading: boolean } {
  const isPr = entry.target === "pull-request";
  const projectId = entry.projectId ?? (isPr ? null : entry.scopeId);
  const prLinks = useQuery({
    queryKey: ["prWorkItems", entry.organizationId, entry.scopeId, entry.id],
    queryFn: () =>
      listPullRequestWorkItems(
        prLocator({ organizationId: entry.organizationId, projectId: projectId!, repositoryId: entry.scopeId, pullRequestId: entry.id }),
      ),
    enabled: isPr && projectId !== null,
    staleTime: 60_000,
  });
  const linkedIds = (prLinks.data ?? []).slice(0, MAX_LINKS);
  const linkedPreviews = useQueries({
    queries: linkedIds.map((id) => ({
      queryKey: workItemQueryKeys.preview(entry.organizationId, projectId ?? undefined, id, ""),
      queryFn: () => getWorkItemPreview({ organizationId: entry.organizationId, projectId: projectId!, workItemId: id }),
      staleTime: 30_000,
    })),
  });
  const wiPreview = useQuery({
    queryKey: workItemQueryKeys.preview(entry.organizationId, entry.scopeId, entry.id, ""),
    queryFn: () => getWorkItemPreview({ organizationId: entry.organizationId, projectId: entry.scopeId, workItemId: entry.id }),
    enabled: !isPr,
    staleTime: 30_000,
  });

  if (isPr) {
    return {
      loading: prLinks.isLoading && projectId !== null,
      links: linkedIds.map((id, index) => {
        const preview = linkedPreviews[index]?.data;
        return { kind: "WI", id, title: preview?.title ?? "", relation: "Linked", webUrl: preview?.webUrl ?? null };
      }),
    };
  }
  const preview = wiPreview.data;
  const links: Link[] = [
    ...(preview?.pullRequests ?? []).map((pr) => ({
      kind: "PR" as const,
      id: pr.pullRequestId,
      title: pr.title ?? "",
      relation: pr.status ? `Pull request (${pr.status})` : "Pull request",
      repositoryId: pr.repositoryId,
      webUrl: pr.webUrl,
    })),
    ...(preview?.relations ?? []).map((relation) => ({
      kind: "WI" as const,
      id: relation.id,
      title: relation.title ?? "",
      relation: relation.relationType,
      webUrl: relation.webUrl,
    })),
  ];
  return { loading: wiPreview.isLoading, links: links.slice(0, MAX_LINKS) };
}

const linkButton = "rounded px-1 text-link hover:underline focus:outline-none focus:ring-2 focus:ring-ring";

function Row({ kind, id, title, relation, onOpen, webUrl, self }: Omit<Link, "repositoryId"> & { onOpen: () => void; self?: boolean }) {
  const label = `${kind === "PR" ? "!" : "#"}${id}`;
  return (
    <li className={`grid grid-cols-[24px_1fr_auto_auto] items-center gap-2 px-2 py-0.5 ${self ? "bg-primary/10" : ""}`}>
      <span className={`text-xs font-bold ${kind === "PR" ? "text-link" : "text-success"}`}>{kind}</span>
      <span className="truncate">
        <span className="text-muted-foreground tabular-nums">{label}</span> {title}{" "}
        <span className="text-muted-foreground">· {relation}</span>
      </span>
      <button type="button" className={linkButton} onClick={onOpen} aria-label={`Open ${label} in DevDeck`}>
        Open
      </button>
      {webUrl ? (
        <button type="button" className={linkButton} onClick={() => void openExternalUrl(webUrl)} aria-label={`Open ${label} in Azure DevOps`}>
          Azure DevOps ↗
        </button>
      ) : (
        <span />
      )}
    </li>
  );
}

export function AgentWorkLinks({ entry }: { entry: AgentWorkEntry }) {
  const { links, loading } = useLinks(entry);
  const kind = entry.target === "pull-request" ? "PR" : "WI";
  return (
    <section aria-label="Target and linked items" className="shrink-0 rounded border border-border text-xs">
      <p className="border-b border-border bg-muted/40 px-2 py-0.5 text-muted-foreground">
        Target and linked items · O open in DevDeck · Shift+O open in Azure DevOps
      </p>
      <ul>
        <Row
          kind={kind}
          id={entry.id}
          title={entry.title}
          relation="Target"
          webUrl={entry.webUrl}
          onOpen={() => openEntryInApp(entry)}
          self
        />
        {links.map((link) => (
          <Row
            key={`${link.kind}${link.id}`}
            {...link}
            onOpen={() => openLink(link, entry.organizationId)}
          />
        ))}
        {loading ? <li className="px-2 py-0.5 text-muted-foreground">Loading linked items…</li> : null}
      </ul>
    </section>
  );
}
