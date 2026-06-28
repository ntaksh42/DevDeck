import { useCallback, useEffect, useMemo, useState } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  searchAll,
  searchCode,
  submitPullRequestVote,
  type Organization,
  type PullRequestSummary,
} from "@/lib/azdoCommands";
import { openExternalUrl } from "@/lib/openExternal";
import { loadRecentPaletteEntries } from "@/lib/recentItems";
import type { CommandPaletteSearchItem } from "@/components/CommandPalette";
import { parsePaletteSearch, commitFirstLine } from "./appHelpers";
import type { PaletteSearchKind, ExternalSearchRequest, View } from "./types";

export interface PaletteSearchCallbacks {
  setWorkItemSearchRequest: (req: ExternalSearchRequest) => void;
  setPullRequestSearchRequest: (req: ExternalSearchRequest) => void;
  setCommitSearchRequest: (req: ExternalSearchRequest) => void;
  setView: (view: View) => void;
}

export interface UsePaletteSearchResult {
  paletteSearchText: string;
  setPaletteSearchText: (text: string) => void;
  paletteSearchItems: CommandPaletteSearchItem[];
  paletteRecentItems: CommandPaletteSearchItem[];
  paletteSearchEnabled: boolean;
  searchAllQueryIsFetching: boolean;
}

export function usePaletteSearch(
  commandPaletteOpen: boolean,
  organizations: Organization[],
  callbacks: PaletteSearchCallbacks,
): UsePaletteSearchResult {
  const queryClient = useQueryClient();
  const [paletteSearchText, setPaletteSearchText] = useState("");
  const [debouncedPaletteSearchText, setDebouncedPaletteSearchText] = useState("");

  useEffect(() => {
    // Clear immediately when text is emptied (e.g. palette close) to avoid a
    // stale query firing on the next open.
    if (paletteSearchText === "") {
      setDebouncedPaletteSearchText("");
      return;
    }
    const timer = window.setTimeout(() => setDebouncedPaletteSearchText(paletteSearchText), 200);
    return () => window.clearTimeout(timer);
  }, [paletteSearchText]);

  const paletteSearch = parsePaletteSearch(debouncedPaletteSearchText);
  const paletteQueryLongEnough = /^\d+$/.test(paletteSearch.query)
    ? paletteSearch.query.length >= 1
    : paletteSearch.query.length >= 2;
  // Code search is heavy and hits the API, so it only runs behind the explicit
  // `code:`/`co:` prefix — never on a generic palette query.
  const paletteSearchEnabled =
    commandPaletteOpen &&
    organizations.length > 0 &&
    paletteSearch.kind !== "code" &&
    paletteQueryLongEnough;
  const paletteCodeEnabled =
    commandPaletteOpen &&
    organizations.length > 0 &&
    paletteSearch.kind === "code" &&
    paletteSearch.query.length >= 2;

  const searchAllQuery = useQuery({
    queryKey: ["searchAll", paletteSearch.query],
    queryFn: () => searchAll({ query: paletteSearch.query }),
    enabled: paletteSearchEnabled,
    staleTime: 30_000,
    // Keep showing the previous results while the next keystroke's search
    // runs, instead of flashing an empty list.
    placeholderData: keepPreviousData,
  });

  // Code search targets the first configured organization (the palette has no
  // org selector); the dedicated Code view offers per-org search.
  const paletteCodeOrgId = organizations[0]?.id;
  const paletteCodeQuery = useQuery({
    queryKey: ["paletteCode", paletteCodeOrgId, paletteSearch.query],
    queryFn: () => searchCode({ organizationId: paletteCodeOrgId, query: paletteSearch.query }),
    enabled: paletteCodeEnabled,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
    // Code Search is an optional extension; a failed query just yields no items.
    retry: false,
  });

  function openSearchTarget(
    kind: PaletteSearchKind,
    query: string,
    organizationId?: string,
  ): void {
    if (kind === "workItems") {
      callbacks.setWorkItemSearchRequest({ query, requestId: Date.now(), organizationId });
      callbacks.setView("workItems");
    } else if (kind === "pullRequests") {
      callbacks.setPullRequestSearchRequest({ query, requestId: Date.now(), organizationId });
      callbacks.setView("pullRequestSearch");
    } else {
      callbacks.setCommitSearchRequest({ query, requestId: Date.now(), organizationId });
      callbacks.setView("commits");
    }
  }

  // Cast a review vote on a PR directly from the command palette (E-36). The
  // palette has no toast surface, so failures are logged; the resulting state
  // reflects in My Reviews, which is invalidated on success.
  const votePullRequest = useCallback(
    (pr: PullRequestSummary, vote: 10 | -10) => {
      void submitPullRequestVote({
        organizationId: pr.organizationId,
        projectId: pr.projectId,
        repositoryId: pr.repositoryId,
        pullRequestId: pr.pullRequestId,
        vote,
      })
        .then(() => {
          void queryClient.invalidateQueries({ queryKey: ["myReviews"] });
        })
        .catch((error) => {
          console.error("Failed to submit pull request vote from palette", error);
        });
    },
    [queryClient],
  );

  const paletteSearchItems = useMemo<CommandPaletteSearchItem[]>(() => {
    const kind = paletteSearch.kind;
    const showOrg = organizations.length > 1;

    // Code is a distinct, opt-in search (own query); surface its file hits and
    // return early since searchAll does not cover code.
    if (kind === "code") {
      const codeData = paletteCodeEnabled ? paletteCodeQuery.data : undefined;
      const codeItems: CommandPaletteSearchItem[] = [];
      for (const hit of codeData?.results ?? []) {
        codeItems.push({
          id: `code:${hit.projectName}:${hit.repositoryName}:${hit.branch ?? ""}:${hit.path}`,
          group: "Code",
          label: hit.fileName,
          detail: [hit.path, `${hit.projectName} / ${hit.repositoryName}`]
            .filter(Boolean)
            .join(" · "),
          // No in-app file viewer; open the file in Azure DevOps.
          run: () => {
            void openExternalUrl(hit.webUrl);
          },
        });
      }
      return codeItems;
    }

    const data = paletteSearchEnabled ? searchAllQuery.data : undefined;
    if (!data) return [];
    const items: CommandPaletteSearchItem[] = [];
    const rawQuery = paletteSearch.query;

    if (!kind || kind === "workItems") {
      for (const item of data.workItems) {
        items.push({
          id: `wi:${item.organizationId}:${item.id}`,
          group: "Work Items",
          label: `#${item.id} ${item.title}`,
          detail: [
            showOrg ? item.organizationId : null,
            item.workItemType,
            item.state,
            item.assignedTo,
          ]
            .filter(Boolean)
            .join(" · "),
          run: () => {
            openSearchTarget("workItems", String(item.id), item.organizationId);
          },
          runAlt: item.webUrl
            ? () => {
                void openExternalUrl(item.webUrl as string);
              }
            : undefined,
        });
      }
      if (data.totals.workItems > data.workItems.length) {
        items.push({
          id: "wi:more",
          group: "Work Items",
          label: `Show all ${data.totals.workItems} work items…`,
          run: () => {
            callbacks.setWorkItemSearchRequest({ query: rawQuery, requestId: Date.now() });
            callbacks.setView("workItems");
          },
        });
      }
    }
    if (!kind || kind === "pullRequests") {
      for (const pr of data.pullRequests) {
        items.push({
          id: `pr:${pr.organizationId}:${pr.repositoryId}:${pr.pullRequestId}`,
          group: "Pull Requests (active)",
          label: `PR ${pr.pullRequestId} ${pr.title}`,
          detail: [showOrg ? pr.organizationId : null, pr.repositoryName, pr.createdBy]
            .filter(Boolean)
            .join(" · "),
          run: () => {
            openSearchTarget("pullRequests", String(pr.pullRequestId), pr.organizationId);
          },
          runAlt: pr.webUrl
            ? () => {
                void openExternalUrl(pr.webUrl as string);
              }
            : undefined,
        });
      }
      if (data.totals.pullRequests > data.pullRequests.length) {
        items.push({
          id: "pr:more",
          group: "Pull Requests (active)",
          label: `Show all ${data.totals.pullRequests} pull requests…`,
          run: () => {
            callbacks.setPullRequestSearchRequest({ query: rawQuery, requestId: Date.now() });
            callbacks.setView("pullRequestSearch");
          },
        });
      }
      // When the user explicitly filters to PRs, offer direct approve/reject
      // actions per result (E-36) so a review vote can be cast from the palette.
      if (kind === "pullRequests") {
        for (const pr of data.pullRequests) {
          items.push({
            id: `pr-approve:${pr.organizationId}:${pr.repositoryId}:${pr.pullRequestId}`,
            group: "Pull Request actions",
            label: `Approve PR ${pr.pullRequestId} — ${pr.title}`,
            detail: showOrg ? pr.organizationId : pr.repositoryName,
            run: () => votePullRequest(pr, 10),
          });
          items.push({
            id: `pr-reject:${pr.organizationId}:${pr.repositoryId}:${pr.pullRequestId}`,
            group: "Pull Request actions",
            label: `Reject PR ${pr.pullRequestId} — ${pr.title}`,
            detail: showOrg ? pr.organizationId : pr.repositoryName,
            run: () => votePullRequest(pr, -10),
          });
        }
      }
    }
    if (!kind || kind === "commits") {
      for (const commit of data.commits) {
        items.push({
          id: `c:${commit.organizationId}:${commit.repositoryId}:${commit.commitId}`,
          group: "Commits",
          label: `${commit.shortCommitId} ${commitFirstLine(commit.comment)}`,
          detail: [
            showOrg ? commit.organizationId : null,
            commit.repositoryName,
            commit.authorName,
          ]
            .filter(Boolean)
            .join(" · "),
          run: () => {
            openSearchTarget("commits", rawQuery, commit.organizationId);
          },
          runAlt: commit.webUrl
            ? () => {
                void openExternalUrl(commit.webUrl as string);
              }
            : undefined,
        });
      }
      if (data.totals.commits > data.commits.length) {
        items.push({
          id: "c:more",
          group: "Commits",
          label: `Show all ${data.totals.commits} commits…`,
          run: () => {
            callbacks.setCommitSearchRequest({ query: rawQuery, requestId: Date.now() });
            callbacks.setView("commits");
          },
        });
      }
    }
    return items;
  }, [
    paletteSearch.kind,
    paletteSearch.query,
    paletteSearchEnabled,
    searchAllQuery.data,
    votePullRequest,
    paletteCodeEnabled,
    paletteCodeQuery.data,
  ]);

  // The palette surfaces recently opened Work Items and PRs. With an empty query
  // it lists them newest-first; while typing it narrows them by id or title so a
  // previously opened item is reachable without re-running a search.
  const paletteRecentItems = useMemo<CommandPaletteSearchItem[]>(() => {
    if (!commandPaletteOpen || organizations.length === 0) return [];
    // A prefixed search (wi:/pr:/c:) is an explicit live search, not a recents lookup.
    if (paletteSearch.kind !== null) return [];
    // Once live cross-org search kicks in, those results stand on their own;
    // recents are the fallback for an empty or too-short query.
    if (paletteSearchEnabled) return [];
    const filterText = debouncedPaletteSearchText.trim().toLowerCase();
    const matches = loadRecentPaletteEntries(organizations.length > 1).filter((entry) => {
      if (filterText.length === 0) return true;
      const needle = filterText.replace(/^#/, "");
      return entry.label.toLowerCase().includes(needle) || entry.query.includes(needle);
    });
    return matches.map((entry) => ({
      id: `recent:${entry.key}`,
      group: "Recent",
      label: entry.label,
      detail: entry.detail,
      run: () => {
        openSearchTarget(entry.kind, entry.query, entry.organizationId);
      },
      runAlt: entry.webUrl
        ? () => {
            void openExternalUrl(entry.webUrl as string);
          }
        : undefined,
    }));
  }, [
    commandPaletteOpen,
    debouncedPaletteSearchText,
    organizations.length,
    paletteSearch.kind,
    paletteSearchEnabled,
  ]);

  return {
    paletteSearchText,
    setPaletteSearchText,
    paletteSearchItems,
    paletteRecentItems,
    paletteSearchEnabled,
    searchAllQueryIsFetching: searchAllQuery.isFetching,
  };
}
