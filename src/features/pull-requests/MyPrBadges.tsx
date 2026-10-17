import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  getPullRequestHealth,
  listPullRequestPolicies,
  prLocator,
  type MyCreatedPullRequestSummary,
  type PolicyRequirement,
  type PrHealth,
} from "@/lib/azdoCommands";
import { readStoredJson, writeStoredJson } from "@/lib/storage";
import { sendPullRequestReadyNotification } from "@/lib/desktopNotifications";
import { isBlockingRequirement } from "./PrMergeRequirements";

const BADGE = "inline-flex shrink-0 items-center rounded border px-1.5 py-0.5 text-[11px] font-medium";
const RED = "border-red-200 bg-red-100 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300";
const AMBER = "border-amber-200 bg-amber-100 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300";
const GREEN = "border-green-200 bg-green-100 text-green-800 dark:border-green-900 dark:bg-green-950 dark:text-green-300";
const NOTIFIED_KEY = "azdodeck:myPullRequests:readyNotified";

/**
 * Everyone approved, not a draft, no conflicts; once the checks are known also
 * no failed or running CI and no unmet required policy. Checks that are not
 * known yet do not block the verdict, they just are not part of it.
 */
export function isReadyToMerge(
  pr: MyCreatedPullRequestSummary,
  health?: PrHealth,
  policies?: PolicyRequirement[],
): boolean {
  return (
    !pr.isDraft &&
    pr.mergeStatus !== "conflicts" &&
    health?.mergeStatus !== "conflicts" &&
    pr.reviewerCount > 0 &&
    pr.approvals >= pr.reviewerCount &&
    health?.ciStatus !== "failed" &&
    health?.ciStatus !== "in_progress" &&
    !(policies ?? []).some(isBlockingRequirement)
  );
}

function readNotified(): number[] {
  return readStoredJson<number[]>(
    NOTIFIED_KEY,
    (value) => (Array.isArray(value) ? (value as number[]) : undefined),
    [],
  );
}

/**
 * Status badges next to a pull request's title. The CI verdict, open comments
 * and policy evaluation are fetched per row, and only for rows that are
 * rendered (the grid is windowed), to keep the request count bounded.
 */
export function MyPrBadges({ pr }: { pr: MyCreatedPullRequestSummary }) {
  const locator = prLocator(pr);
  const health = useQuery({
    queryKey: ["prHealth", pr.organizationId, pr.repositoryId, pr.pullRequestId],
    queryFn: () => getPullRequestHealth(locator),
    staleTime: 60_000,
    retry: false,
  });
  const policies = useQuery({
    queryKey: ["prPolicies", pr.organizationId, pr.repositoryId, pr.pullRequestId],
    queryFn: () => listPullRequestPolicies(locator),
    staleTime: 30_000,
    retry: false,
  });

  const blocked = (policies.data ?? []).filter(isBlockingRequirement).length;
  const ready = isReadyToMerge(pr, health.data, policies.data);
  // Notify once per pull request, and only after the checks have been read:
  // approvals alone are not enough to say it can merge.
  const checked = health.isSuccess && policies.isSuccess;

  useEffect(() => {
    if (!ready || !checked) return;
    const notified = readNotified();
    if (notified.includes(pr.pullRequestId)) return;
    writeStoredJson(NOTIFIED_KEY, [...notified, pr.pullRequestId].slice(-200));
    void sendPullRequestReadyNotification({
      title: pr.title,
      pullRequestId: pr.pullRequestId,
      repositoryName: pr.repositoryName,
      webUrl: pr.webUrl,
    });
  }, [ready, checked, pr.pullRequestId, pr.title, pr.repositoryName, pr.webUrl]);

  return (
    <>
      {pr.mergeStatus === "conflicts" || health.data?.mergeStatus === "conflicts" ? (
        <span className={`${BADGE} ${RED}`} title="This pull request has merge conflicts">
          Conflicts
        </span>
      ) : null}
      {health.data?.ciStatus === "failed" ? (
        <span className={`${BADGE} ${RED}`} title={`CI failed: ${health.data.ciContext ?? ""}`}>
          CI failed
        </span>
      ) : null}
      {health.data?.ciStatus === "in_progress" ? (
        <span className={`${BADGE} ${AMBER}`} title={`CI running: ${health.data.ciContext ?? ""}`}>
          CI running
        </span>
      ) : null}
      {health.data && health.data.unresolvedThreads > 0 ? (
        <span
          className={`${BADGE} ${AMBER}`}
          title={`${health.data.unresolvedThreads} comment thread(s) still open`}
        >
          {health.data.unresolvedThreads} unresolved
        </span>
      ) : null}
      {blocked > 0 ? (
        <span className={`${BADGE} ${RED}`} title="Required policies that have not passed">
          Blocked ({blocked})
        </span>
      ) : null}
      {ready ? (
        <span
          className={`${BADGE} ${GREEN}`}
          title="Everyone approved, no conflicts, and the checks read so far are clean"
        >
          Ready to merge
        </span>
      ) : null}
    </>
  );
}
