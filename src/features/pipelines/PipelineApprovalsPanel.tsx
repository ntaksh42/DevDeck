import { Check, Loader2, X } from "lucide-react";
import { type PipelineApprovalSummary } from "@/lib/azdoCommands";

export function PipelineApprovalsPanel({
  approvals,
  pendingApprovalId,
  error,
  onAct,
}: {
  approvals: PipelineApprovalSummary[];
  pendingApprovalId: string | null;
  error: string | null;
  onAct: (approvalId: string, status: "approved" | "rejected") => void;
}) {
  return (
    <div className="shrink-0 rounded-md border border-amber-300 bg-amber-50 dark:border-amber-700/60 dark:bg-amber-950/30">
      <div className="border-b border-amber-200 px-3 py-2 text-sm font-medium text-amber-800 dark:border-amber-800/60 dark:text-amber-200">
        Pending approvals ({approvals.length})
      </div>
      {error ? (
        <p role="alert" className="px-3 py-2 text-xs text-destructive">
          {error}
        </p>
      ) : null}
      <ul className="divide-y divide-amber-200/70 dark:divide-amber-800/40">
        {approvals.map((approval) => {
          const busy = pendingApprovalId === approval.id;
          return (
            <li
              key={approval.id}
              className="flex items-center gap-3 px-3 py-2 text-sm"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-foreground">
                  {approval.instructions?.trim() || "Approval required to continue"}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {approval.assignedApprovers.join(", ") || "Assigned to you"}
                  {approval.minRequiredApprovers > 1
                    ? ` · ${approval.minRequiredApprovers} approvers required`
                    : ""}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onAct(approval.id, "approved")}
                  className="inline-flex h-7 items-center gap-1 rounded-md bg-emerald-600 px-2 text-xs font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {busy ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  ) : (
                    <Check className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                  Approve
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onAct(approval.id, "rejected")}
                  className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-background px-2 text-xs font-medium text-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                  Reject
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
