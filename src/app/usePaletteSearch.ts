import { useCallback, useEffect, useMemo, useState } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  searchAll,
  searchWiki,
  submitPullRequestVote,
  type Organization,
  type PullRequestSummary,
} from "@/lib/azdoCommands";
import { openWikiPagePreview } from "@/features/wiki/wikiPreviewEvents";
import { openExternalUrl } from "@/lib/openExternal";
import { useActiveOrganizationId } from "@/lib/useActiveConnection";
import { loadRecentPaletteEntries } from "@/lib/recentItems";
import type { CommandPaletteSearchItem } from "@/components/CommandPalette";
import { parsePaletteSearch } from "./appHelpers";
import type { ExternalSearchRequest, View } from "./types";

export interface PaletteSearchCallbacks {
  setWorkItemSearchRequest: (req: ExternalSearchRequest) => void;
  setPullRequestSearchRequest: (req: ExternalSearchRequest) => void;
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
  // Wiki search hits the API, so it only runs behind the explicit `wiki:`
  // prefix — never on a generic palette query.
  const paletteSearchEnabled =
    commandPaletteOpen &&
    organizations.length > 0 &&
    paletteSearch.kind !== "wiki" &&
    paletteQueryLongEnough;
  const paletteWikiEnabled =
    commandPaletteOpen &&
    organizations.length > 0 &&
    paletteSearch.kind === "wiki" &&
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

  // Wiki search targets the active connection (the palette has no org
  // selector), falling back to the first one until the active id has loaded.
  const activeOrganizationId = useActiveOrganizationId();
  const paletteCodeOrgId = activeOrganizationId || organizations[0]?.id;
  const paletteWikiQuery = useQuery({
    queryKey: ["paletteWiki", paletteCodeOrgId, paletteSearch.query],
    queryFn: () => searchWiki({ organizationId: paletteCodeOrgId, query: paletteSearch.query }),
    enabled: paletteWikiEnabled,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
    // Wiki search needs the optional Search extension; a failure is reported as
    // a single "unavailable" row instead of retrying.
    retry: false,
  });

  function openSearchTarget(
    kind: "workItems" | "pullRequests",
    query: string,
    organizationId?: string,
  ): void {
    if (kind === "workItems") {
      callbacks.setWorkItemSearchRequest({ query, requestId: Date.now(), organizationId });
      callbacks.setView("workItems");
    } else {
      callbacks.setPullRequestSearchRequest({ query, requestId: Date.now(), organizationId });
      callbacks.setView("pullRequestSearch");
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
          // The palette's own rows come from this query; without it the voted
          // row keeps offering the same vote action and invites a double vote.
          void queryClient.invalidateQueries({ queryKey: ["searchAll"] });
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

    // Wiki is its own opt-in search; a hit opens an in-app page preview
    // (edits stay in the browser).
    if (kind === "wiki") {
      const wikiData = paletteWikiEnabled ? paletteWikiQuery.data : undefined;
      const wikiItems: CommandPaletteSearchItem[] = [];
      if (paletteWikiEnabled && paletteWikiQuery.isError) {
        wikiItems.push({
          id: "wiki:unavailable",
          group: "Wiki",
          label: "Wiki Search is unavailable",
          detail: "The extension may be disabled or the token lacks permission.",
          run: () => {},
        });
      }
      for (const hit of wikiData?.results ?? []) {
        wikiItems.push({
          id: `wiki:${hit.projectId}:${hit.wikiId}:${hit.pagePath}`,
          group: "Wiki",
          label: hit.pagePath,
          detail: `${hit.projectName} / ${hit.wikiName}`,
          run: () => openWikiPagePreview({ organizationId: paletteCodeOrgId, hit }),
          runAlt: () => {
            void openExternalUrl(hit.webUrl);
          },
        });
      }
      return wikiItems;
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
    return items;
  }, [
    paletteSearch.kind,
    paletteSearch.query,
    paletteSearchEnabled,
    searchAllQuery.data,
    votePullRequest,
    paletteWikiEnabled,
    paletteWikiQuery.data,
    paletteWikiQuery.isError,
    paletteCodeOrgId,
  ]);

  // The palette surfaces recently opened Work Items and PRs. With an empty query
  // it lists them newest-first; while typing it narrows them by id or title so a
  // previously opened item is reachable without re-running a search.
  const paletteRecentItems = useMemo<CommandPaletteSearchItem[]>(() => {
    if (!commandPaletteOpen || organizations.length === 0) return [];
    // A prefixed search (wi:/pr:/wiki:) is an explicit live search, not a recents lookup.
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
