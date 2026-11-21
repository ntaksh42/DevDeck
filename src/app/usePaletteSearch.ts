import { useCallback, useEffect, useMemo, useState } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  listActionInboxItems,
  searchAll,
  searchWiki,
  setActiveOrganization,
  setActionInboxItemState,
  submitPullRequestVote,
  type Organization,
  type PullRequestSummary,
  commandErrorMessage,
} from "@/lib/azdoCommands";
import { openWikiPagePreview } from "@/features/wiki/wikiPreviewEvents";
import { pushToast } from "@/lib/toast";
import { isTauriRuntime } from "@/lib/runtime";
import { openExternalUrl } from "@/lib/openExternal";
import { useActiveOrganizationId } from "@/lib/useActiveConnection";
import { loadRecentPaletteEntries } from "@/lib/recentItems";
import { SNOOZE_PRESETS, presetToIso } from "@/lib/snoozePresets";
import type { CommandPaletteSearchItem } from "@/components/CommandPalette";
import { parsePaletteSearch } from "./appHelpers";
import { paletteUrlItems, parsePaletteUrl } from "./paletteUrl";
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
  paletteSearchStatus: string;
  paletteSearchError: string | undefined;
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
    const timer = window.setTimeout(() => setDebouncedPaletteSearchText(paletteSearchText), 300);
    return () => window.clearTimeout(timer);
  }, [paletteSearchText]);

  const activeOrganizationId = useActiveOrganizationId();
  const paletteSearch = parsePaletteSearch(debouncedPaletteSearchText);
  // A pasted Azure DevOps link opens its item directly instead of being searched as text.
  const paletteUrl = useMemo(
    () => parsePaletteUrl(debouncedPaletteSearchText, organizations),
    [debouncedPaletteSearchText, organizations],
  );
  const paletteQueryLongEnough = /^\d+$/.test(paletteSearch.query)
    ? paletteSearch.query.length >= 1
    : paletteSearch.query.length >= 2;
  // Wiki search hits the API, so it only runs behind the explicit `wiki:`
  // prefix — never on a generic palette query.
  const paletteSearchEnabled =
    commandPaletteOpen &&
    !!activeOrganizationId &&
    paletteSearch.kind !== "wiki" &&
    paletteUrl === null &&
    paletteSearch.kind !== "inbox" &&
    paletteQueryLongEnough;
  const paletteWikiEnabled =
    commandPaletteOpen &&
    organizations.length > 0 &&
    paletteSearch.kind === "wiki" &&
    paletteSearch.query.length >= 2;

  const searchAllQuery = useQuery({
    queryKey: ["searchAll", activeOrganizationId, paletteSearch.kind, paletteSearch.query],
    queryFn: () => searchAll({ organizationId: activeOrganizationId, query: paletteSearch.query,
      ...(paletteSearch.kind === "workItems" || paletteSearch.kind === "pullRequests" ? { kind: paletteSearch.kind } : {}),
    }),
    enabled: paletteSearchEnabled,
    staleTime: 15_000,
    retry: false,
  });

  // Wiki search targets the active connection (the palette has no org
  // selector), falling back to the first one until the active id has loaded.
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

  // Inbox rows are local (SQLite), so the `inbox:` list needs no minimum query
  // length; the text only narrows the Open items client-side.
  const paletteInboxEnabled =
    commandPaletteOpen && organizations.length > 0 && paletteSearch.kind === "inbox";
  const paletteInboxQuery = useQuery({
    queryKey: ["actionInbox", "palette"],
    queryFn: () => listActionInboxItems({ state: "open" }),
    enabled: paletteInboxEnabled,
    staleTime: 5_000,
  });

  function openSearchTarget(
    kind: "workItems" | "pullRequests",
    query: string,
    organizationId?: string,
    target?: Pick<ExternalSearchRequest, "workItem" | "pullRequest">,
  ): void {
    if (kind === "workItems") {
      callbacks.setWorkItemSearchRequest({ query, requestId: Date.now(), organizationId, ...target });
      callbacks.setView("workItems");
    } else {
      callbacks.setPullRequestSearchRequest({ query, requestId: Date.now(), organizationId, ...target });
      callbacks.setView("pullRequestSearch");
    }
  }

  // The search views read the active connection, so targets in another
  // organization switch to it before opening the search view.
  function openLinkedItem(
    kind: "workItems" | "pullRequests", query: string, organizationId: string,
    target?: Pick<ExternalSearchRequest, "workItem" | "pullRequest">,
  ): void {
    void (async () => {
      if (organizationId !== activeOrganizationId) {
        await setActiveOrganization(organizationId);
        await queryClient.invalidateQueries();
      }
      if (!target) {
        const result = await searchAll({ organizationId, query, kind });
        const workItem = result.workItems.find((wi) => String(wi.id) === query);
        const pullRequest = result.pullRequests.find((pr) => String(pr.pullRequestId) === query);
        if (kind === "workItems" ? !workItem : !pullRequest) {
          throw new Error(result.warnings?.join("; ") || "Item not found or no longer accessible (PRs must be active).");
        }
        target = kind === "workItems" ? { workItem } : { pullRequest };
      }
      openSearchTarget(kind, query, organizationId, target);
    })().catch((error) => pushToast(commandErrorMessage(error)));
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

  // Done / Snooze straight from the palette. Failures are logged (no toast
  // surface here); the Inbox list and badge refresh through the invalidation.
  const changeInboxItem = useCallback(
    (id: number, state: "done" | "snoozed", snoozedUntil?: string) => {
      void setActionInboxItemState({ ids: [id], state, snoozedUntil })
        .then(() => queryClient.invalidateQueries({ queryKey: ["actionInbox"] }))
        .catch((error) => {
          console.error("Failed to update Inbox item from palette", error);
        });
    },
    [queryClient],
  );

  const paletteSearchItems = useMemo<CommandPaletteSearchItem[]>(() => {
    if (paletteUrl) return paletteUrlItems(paletteUrl, activeOrganizationId, openLinkedItem);
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

    if (kind === "inbox") {
      const needle = paletteSearch.query.toLowerCase();
      const tomorrow = SNOOZE_PRESETS.find((preset) => preset.id === "tomorrow");
      const inboxItems: CommandPaletteSearchItem[] = [];
      for (const item of paletteInboxEnabled ? (paletteInboxQuery.data ?? []) : []) {
        const haystack = [item.title, item.repositoryName, item.author, item.snippet]
          .join(" ")
          .toLowerCase();
        if (needle && !haystack.includes(needle)) continue;
        const detail = [showOrg ? item.organizationId : null, item.repositoryName, item.author]
          .filter(Boolean)
          .join(" · ");
        inboxItems.push({
          id: `inbox-done:${item.id}`,
          group: "Inbox",
          label: `Done — ${item.title}`,
          detail,
          run: () => changeInboxItem(item.id, "done"),
        });
        if (tomorrow) {
          inboxItems.push({
            id: `inbox-snooze:${item.id}`,
            group: "Inbox",
            label: `Snooze until tomorrow — ${item.title}`,
            detail,
            run: () => changeInboxItem(item.id, "snoozed", presetToIso(tomorrow)),
          });
        }
      }
      return inboxItems;
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
            item.projectName,
            item.workItemType,
            item.state,
            item.assignedTo,
          ]
            .filter(Boolean)
            .join(" · "),
          run: () => {
            openLinkedItem("workItems", String(item.id), item.organizationId, { workItem: item });
          },
          runAlt: item.webUrl
            ? () => {
                void openExternalUrl(item.webUrl as string);
              }
            : undefined,
        });
      }
    }
    if (!kind || kind === "pullRequests") {
      for (const pr of data.pullRequests) {
        items.push({
          id: `pr:${pr.organizationId}:${pr.repositoryId}:${pr.pullRequestId}`,
          group: "Pull Requests (active)",
          label: `PR ${pr.pullRequestId} ${pr.title}`,
          detail: [pr.projectName, pr.repositoryName, pr.createdBy]
            .filter(Boolean)
            .join(" · "),
          run: () => {
            openLinkedItem("pullRequests", String(pr.pullRequestId), pr.organizationId, { pullRequest: pr });
          },
          runAlt: pr.webUrl
            ? () => {
                void openExternalUrl(pr.webUrl as string);
              }
            : undefined,
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
    // Keep groups together, but put the group with an exact ID hit first.
    if (data.pullRequests.some((pr) => String(pr.pullRequestId) === rawQuery) &&
        !data.workItems.some((item) => String(item.id) === rawQuery)) {
      items.sort((a, b) => Number(b.group === "Pull Requests (active)") - Number(a.group === "Pull Requests (active)"));
    }
    return items;
  }, [
    paletteSearch.kind,
    paletteSearch.query,
    paletteSearchEnabled,
    searchAllQuery.data,
    votePullRequest,
    changeInboxItem,
    paletteInboxEnabled,
    paletteInboxQuery.data,
    paletteWikiEnabled,
    paletteWikiQuery.data,
    paletteWikiQuery.isError,
    paletteCodeOrgId,
    paletteUrl,
    activeOrganizationId,
  ]);

  // The palette surfaces recently opened Work Items and PRs. With an empty query
  // it lists them newest-first; while typing it narrows them by id or title so a
  // previously opened item is reachable without re-running a search.
  const paletteRecentItems = useMemo<CommandPaletteSearchItem[]>(() => {
    if (!commandPaletteOpen || organizations.length === 0) return [];
    // A prefixed search (wi:/pr:/wiki:/inbox:) is an explicit live search, not a recents lookup.
    if (paletteSearch.kind !== null) return [];
    // Once live search kicks in, those results stand on their own;
    // recents are the fallback for an empty or too-short query.
    if (paletteSearchEnabled) return [];
    const filterText = debouncedPaletteSearchText.trim().toLowerCase();
    const matches = loadRecentPaletteEntries(false).filter((entry) => {
      if (!activeOrganizationId || entry.organizationId !== activeOrganizationId) return false;
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
        openLinkedItem(entry.kind, entry.query, entry.organizationId);
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
    activeOrganizationId,
  ]);

  return {
    paletteSearchText,
    setPaletteSearchText,
    paletteSearchItems: paletteSearchText === debouncedPaletteSearchText ? paletteSearchItems : [],
    paletteRecentItems: paletteSearchText === debouncedPaletteSearchText ? paletteRecentItems : [],
    paletteSearchEnabled,
    searchAllQueryIsFetching: searchAllQuery.isFetching || paletteWikiQuery.isFetching || (paletteSearchText.trim() !== "" && paletteSearchText !== debouncedPaletteSearchText),
    paletteSearchError: paletteSearchEnabled && searchAllQuery.isError ? commandErrorMessage(searchAllQuery.error) : undefined,
    paletteSearchStatus: [
      isTauriRuntime() ? `Search: ${organizations.find((org) => org.id === activeOrganizationId)?.displayName || organizations.find((org) => org.id === activeOrganizationId)?.name || "current organization"} · all accessible projects · active PRs only`
        : "Demo data only — real Azure DevOps items are available in the desktop app.",
      ...(paletteSearchEnabled ? searchAllQuery.data?.warnings ?? [] : []),
      paletteSearchEnabled && searchAllQuery.data &&
        ((paletteSearch.kind !== "pullRequests" && searchAllQuery.data.totals.workItems > searchAllQuery.data.workItems.length) ||
         (paletteSearch.kind !== "workItems" && searchAllQuery.data.totals.pullRequests > searchAllQuery.data.pullRequests.length))
          ? "More matches available. Refine your search to narrow the results." : "",
    ].filter(Boolean).join(" · "),
  };
}
