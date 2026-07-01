import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, Loader2 } from "lucide-react";
import { listRepoBranches } from "@/lib/commands/code";
import {
  cherryPickCommit,
  revertCommit,
  type CommitSummary,
  type CommitRefOperationResult,
} from "@/lib/azdoCommands";
import { commandErrorMessage } from "@/lib/azdoCommands";
import { openExternalUrl } from "@/lib/openExternal";
import { FilterableSelect } from "@/features/pipelines/FilterableSelect";

type OperationKind = "cherry-pick" | "revert";

// Confirmation modal for the two write operations Commits supports: cherry-pick
// and revert. Both create a new branch from a single source commit, so they
// share this dialog (title/labels differ by `kind`). Mirrors ConfirmDialog's
// keyboard model (Escape to cancel, focus trapped/returned) but needs its own
// shell because it also collects the target branch and new branch name first.
export function CommitRefOperationDialog({
  kind,
  commit,
  onClose,
}: {
  kind: OperationKind;
  commit: CommitSummary;
  onClose: () => void;
}) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const branchSelectRef = useRef<HTMLInputElement>(null);

  const branchesQuery = useQuery({
    queryKey: ["repoBranches", commit.organizationId, commit.repositoryId],
    queryFn: () =>
      listRepoBranches({
        organizationId: commit.organizationId,
        project: commit.projectId,
        repository: commit.repositoryId,
      }),
    staleTime: 60_000,
  });
  const branchOptions = (branchesQuery.data ?? []).map((branch) => ({
    value: branch.name,
    label: branch.name,
  }));

  const [ontoBranch, setOntoBranch] = useState("");
  useEffect(() => {
    if (ontoBranch) return;
    const defaultBranch = branchesQuery.data?.find((branch) => branch.isDefault);
    if (defaultBranch) setOntoBranch(defaultBranch.name);
  }, [branchesQuery.data, ontoBranch]);

  const defaultNewBranchName = useMemo(
    () => `${kind === "cherry-pick" ? "cherry-pick" : "revert"}/${commit.shortCommitId}`,
    [kind, commit.shortCommitId],
  );
  const [newBranchName, setNewBranchName] = useState(defaultNewBranchName);

  const mutation = useMutation({
    mutationFn: () => {
      const input = {
        organizationId: commit.organizationId,
        projectId: commit.projectId,
        projectName: commit.projectName,
        repositoryId: commit.repositoryId,
        repositoryName: commit.repositoryName,
        commitId: commit.commitId,
        ontoBranch,
        newBranchName: newBranchName.trim(),
      };
      return kind === "cherry-pick" ? cherryPickCommit(input) : revertCommit(input);
    },
  });
  const result: CommitRefOperationResult | undefined = mutation.data;

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    branchSelectRef.current?.focus();
    return () => {
      window.setTimeout(() => opener?.focus(), 0);
    };
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    }
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [onClose]);

  const label = kind === "cherry-pick" ? "Cherry-pick" : "Revert";
  const canSubmit = !!ontoBranch && newBranchName.trim().length > 0 && !mutation.isPending;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-sm rounded-md border border-border bg-card p-4 shadow-lg"
      >
        <h2 id={titleId} className="text-base font-semibold text-foreground">
          {label} {commit.shortCommitId}
        </h2>

        {result ? (
          result.status === "completed" && !result.conflict ? (
            <div className="mt-3 text-sm">
              <p className="text-foreground">
                {label} succeeded. New branch: <span className="font-mono">{result.newBranchName}</span>
              </p>
              <div className="mt-4 flex justify-end gap-2">
                {result.newBranchWebUrl ? (
                  <button
                    type="button"
                    onClick={() => openExternalUrl(result.newBranchWebUrl as string)}
                    className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    Open branch
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-md border border-border bg-card px-3 py-1.5 text-sm font-medium hover:bg-secondary focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  Close
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-3 text-sm">
              <p className="flex items-start gap-1.5 text-destructive">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                {result.conflict
                  ? `${label} produced a conflict and was not completed.`
                  : (result.failureMessage ?? `${label} did not complete.`)}
              </p>
              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-md border border-border bg-card px-3 py-1.5 text-sm font-medium hover:bg-secondary focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  Close
                </button>
              </div>
            </div>
          )
        ) : (
          <>
            <div className="mt-3 grid gap-3 text-sm">
              <label className="grid gap-1">
                <span className="text-xs font-medium text-muted-foreground">Onto branch</span>
                <FilterableSelect
                  value={ontoBranch}
                  options={branchOptions}
                  onChange={setOntoBranch}
                  disabled={branchesQuery.isLoading}
                  placeholder={branchesQuery.isLoading ? "Loading branches…" : "Select a branch"}
                  ariaLabel="Onto branch"
                />
              </label>
              <label className="grid gap-1">
                <span className="text-xs font-medium text-muted-foreground">New branch name</span>
                <input
                  value={newBranchName}
                  onChange={(event) => setNewBranchName(event.target.value)}
                  className="h-8 rounded-md border border-input bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                />
              </label>
              {mutation.isError ? (
                <p className="text-xs text-destructive">{commandErrorMessage(mutation.error)}</p>
              ) : null}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={mutation.isPending}
                className="rounded-md border border-border bg-card px-3 py-1.5 text-sm font-medium hover:bg-secondary focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => mutation.mutate()}
                disabled={!canSubmit}
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
              >
                {mutation.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                ) : null}
                {label} onto {ontoBranch || "…"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
