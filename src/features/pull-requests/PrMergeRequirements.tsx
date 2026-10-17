import { useQuery } from "@tanstack/react-query";
import { ShieldAlert } from "lucide-react";
import {
  commandErrorMessage,
  listPullRequestPolicies,
  prLocator,
  type PolicyRequirement,
} from "@/lib/azdoCommands";

const STATUS_LABEL: Record<string, string> = {
  approved: "Passed",
  rejected: "Failed",
  running: "Running",
  queued: "Queued",
  broken: "Broken",
};

const PASSED_CLASS =
  "border-green-200 bg-green-100 text-green-800 dark:border-green-900 dark:bg-green-950 dark:text-green-300";
const FAILED_CLASS =
  "border-red-200 bg-red-100 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300";
const WAITING_CLASS =
  "border-amber-200 bg-amber-100 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300";

function statusClass(status: string): string {
  if (status === "approved") return PASSED_CLASS;
  if (status === "rejected" || status === "broken") return FAILED_CLASS;
  return WAITING_CLASS;
}

/** A required policy that has not passed yet is what keeps the pull request from merging. */
export function isBlockingRequirement(policy: PolicyRequirement): boolean {
  return policy.isBlocking && policy.status !== "approved";
}

/**
 * "Merge requirements": how each branch policy evaluates for the pull request.
 * Fetched when the pull request is shown and never part of the sync loop; a
 * failure (typically missing permission) stays inside this row.
 */
export function PrMergeRequirements({
  pr,
}: {
  pr: { organizationId: string; projectId: string; repositoryId: string; pullRequestId: number };
}) {
  const query = useQuery({
    queryKey: ["prPolicies", pr.organizationId, pr.repositoryId, pr.pullRequestId],
    queryFn: () => listPullRequestPolicies(prLocator(pr)),
    staleTime: 30_000,
    retry: false,
  });

  if (query.isError) {
    return (
      <p className="text-[11px] text-muted-foreground" title={commandErrorMessage(query.error)}>
        Merge requirements unavailable.
      </p>
    );
  }
  const policies = query.data ?? [];
  if (policies.length === 0) return null;

  const blocked = policies.filter(isBlockingRequirement).length;
  return (
    <div className="grid min-w-0 grid-cols-[4rem_minmax(0,1fr)] items-baseline gap-1">
      <span className="text-xs text-muted-foreground">Merge</span>
      <div className="flex min-w-0 flex-wrap items-center gap-1" aria-label="Merge requirements">
        {blocked > 0 ? (
          <span
            className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-medium ${FAILED_CLASS}`}
            title={`${blocked} required ${blocked === 1 ? "policy has" : "policies have"} not passed`}
          >
            <ShieldAlert className="h-3 w-3" aria-hidden="true" />
            Blocked ({blocked})
          </span>
        ) : null}
        {policies.map((policy, index) => (
          <span
            key={`${policy.name}-${index}`}
            className={`inline-flex max-w-full items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] [overflow-wrap:anywhere] ${statusClass(policy.status)}`}
            title={[
              policy.isBlocking ? "Required" : "Optional",
              STATUS_LABEL[policy.status] ?? policy.status,
              policy.detail,
            ]
              .filter(Boolean)
              .join(" · ")}
          >
            {policy.name}
            {policy.detail ? ` — ${policy.detail}` : ""}
            <span className="font-medium">
              {STATUS_LABEL[policy.status] ?? policy.status}
              {policy.isBlocking ? "" : " (optional)"}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}
