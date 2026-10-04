import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, X } from "lucide-react";
import { commandErrorMessage, listBranchPolicies } from "@/lib/azdoCommands";
import { openExternalUrl } from "@/lib/openExternal";
import type { RepoOption } from "./codeBrowseShared";

const BUTTON =
  "inline-flex items-center gap-1 rounded-md border border-border bg-card px-2.5 py-1 text-xs font-medium hover:bg-secondary focus:outline-none focus:ring-2 focus:ring-ring";

// Read-only list of the branch policies that apply to one branch. Policies are
// edited in Azure DevOps, so the footer link jumps to the branch's policy page.
// Esc closes, focus starts on the Close button, and returns to the opener.
export function BranchPoliciesDialog({
  organizationId,
  repo,
  branch,
  policiesUrl,
  onClose,
}: {
  organizationId: string;
  repo: RepoOption;
  branch: string;
  policiesUrl: string | null;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const query = useQuery({
    queryKey: ["branchPolicies", organizationId, repo.repositoryId, branch],
    queryFn: () =>
      listBranchPolicies({
        organizationId,
        project: repo.projectId,
        repository: repo.repositoryId,
        branch,
      }),
    staleTime: 60_000,
    retry: false,
  });

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
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

  const policies = query.data ?? [];
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Branch policies for ${branch}`}
        className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-md border border-border bg-card shadow-lg"
      >
        <div className="border-b border-border px-4 py-2">
          <h2 className="text-base font-semibold text-foreground">Branch policies</h2>
          <p className="truncate text-xs text-muted-foreground">
            <span className="font-mono text-foreground">{branch}</span> in {repo.projectName} /{" "}
            {repo.repositoryName}
          </p>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-2 text-sm">
          {query.isPending ? (
            <p className="text-muted-foreground">Loading…</p>
          ) : query.isError ? (
            <p role="alert" className="text-destructive">
              {commandErrorMessage(query.error)}
            </p>
          ) : policies.length === 0 ? (
            <p className="text-muted-foreground">No policies apply to this branch.</p>
          ) : (
            <ul className="divide-y divide-border/60">
              {policies.map((policy) => (
                <li key={policy.id} className="flex items-start justify-between gap-3 py-1.5">
                  <div className="min-w-0">
                    <div className="font-medium text-foreground">{policy.name}</div>
                    {policy.detail ? (
                      <div className="text-xs text-muted-foreground">{policy.detail}</div>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 gap-1 text-[10px]">
                    <span className="rounded border border-border px-1 text-muted-foreground">
                      {policy.isBlocking ? "Required" : "Optional"}
                    </span>
                    {policy.isEnabled ? null : (
                      <span className="rounded border border-border px-1 text-muted-foreground">
                        Disabled
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-border px-4 py-2">
          {policiesUrl ? (
            <button type="button" className={BUTTON} onClick={() => void openExternalUrl(policiesUrl)}>
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              Manage in Azure DevOps
            </button>
          ) : null}
          <button ref={closeRef} type="button" className={BUTTON} onClick={onClose}>
            <X className="h-3.5 w-3.5" aria-hidden="true" />
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
