import {
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, X } from "lucide-react";
import {
  commandErrorMessage,
  createWorkItemBranch,
  listRepoBranches,
  listRepositories,
  type CreateWorkItemBranchResult,
  type WorkItemPreview,
} from "@/lib/azdoCommands";
import { readStoredString, writeStoredString } from "@/lib/storage";
import { useFocusTrap } from "@/lib/useFocusTrap";
import { isImeComposing } from "@/lib/utils";
import { workItemQueryKeys } from "./queryKeys";
import { defaultWorkItemBranchName } from "./workItemBranchName";

const LAST_REPOSITORY_KEY = "azdodeck:workItems:branchRepository";
const inputClass =
  "h-8 rounded-md border border-input bg-background px-2.5 text-sm outline-none focus:ring-2 focus:ring-ring";
const labelClass = "text-xs font-medium text-muted-foreground";

/**
 * Modal that creates a branch for a work item and links it (Development
 * section). Keyboard only: opens on the branch name, Tab moves between the
 * fields, Enter or Ctrl+Enter creates, Escape cancels, and focus returns to the
 * element that opened it.
 */
export function CreateBranchDialog({
  preview,
  onClose,
}: {
  preview: WorkItemPreview;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [repositoryId, setRepositoryId] = useState(readStoredString(LAST_REPOSITORY_KEY) ?? "");
  const [baseBranch, setBaseBranch] = useState("");
  const [branchName, setBranchName] = useState(() =>
    defaultWorkItemBranchName(preview.workItemType, preview.id, preview.title),
  );
  const [result, setResult] = useState<CreateWorkItemBranchResult | null>(null);
  const [copied, setCopied] = useState(false);
  const nameRef = useRef<HTMLInputElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  useFocusTrap(dialogRef, { restoreFocus: true });

  useEffect(() => {
    window.setTimeout(() => nameRef.current?.select(), 0);
  }, []);

  const repositoriesQuery = useQuery({
    queryKey: ["branchDialogRepositories", preview.organizationId],
    queryFn: () => listRepositories({ organizationId: preview.organizationId }),
    staleTime: 5 * 60_000,
  });
  const repositories = (repositoriesQuery.data ?? []).filter(
    (repo) => repo.projectId === preview.projectId,
  );
  const effectiveRepositoryId = repositories.some((repo) => repo.repositoryId === repositoryId)
    ? repositoryId
    : (repositories[0]?.repositoryId ?? "");

  const branchesQuery = useQuery({
    queryKey: ["branchDialogBranches", preview.organizationId, effectiveRepositoryId],
    queryFn: () =>
      listRepoBranches({
        organizationId: preview.organizationId,
        project: preview.projectId,
        repository: effectiveRepositoryId,
      }),
    enabled: !!effectiveRepositoryId,
    staleTime: 60_000,
  });
  const branches = branchesQuery.data ?? [];
  const effectiveBase = branches.some((branch) => branch.name === baseBranch)
    ? baseBranch
    : (branches.find((branch) => branch.isDefault)?.name ?? branches[0]?.name ?? "");

  const mutation = useMutation({
    mutationFn: createWorkItemBranch,
    onSuccess: (created) => {
      writeStoredString(LAST_REPOSITORY_KEY, effectiveRepositoryId);
      void queryClient.invalidateQueries({ queryKey: workItemQueryKeys.previewRoot() });
      setResult(created);
    },
  });

  function submit(event?: FormEvent) {
    event?.preventDefault();
    if (mutation.isPending || result || !effectiveRepositoryId || !effectiveBase) return;
    mutation.mutate({
      organizationId: preview.organizationId,
      projectId: preview.projectId,
      workItemId: preview.id,
      repositoryId: effectiveRepositoryId,
      baseBranch: effectiveBase,
      branchName,
    });
  }

  // Contain keys so the grid underneath does not also react to typing/arrows.
  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    event.stopPropagation();
    if (isImeComposing(event)) return;
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    } else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      submit();
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={onClose}
      onKeyDown={handleKeyDown}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="wi-branch-dialog-title"
        className="relative flex w-full max-w-md flex-col overflow-hidden rounded-lg border border-border bg-popover shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 id="wi-branch-dialog-title" className="text-sm font-semibold">
            Create branch for #{preview.id}
          </h2>
          <button
            type="button"
            aria-label="Close dialog"
            onClick={onClose}
            className="rounded p-1 text-muted-foreground hover:bg-muted"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        {result ? (
          <div className="grid gap-3 p-4 text-sm">
            <p>
              Created <span className="font-mono">{result.branchName}</span>.
            </p>
            {result.linked ? (
              <p className="text-muted-foreground">Linked to the work item.</p>
            ) : (
              <p role="alert" className="text-destructive">
                The branch exists but linking it to the work item failed
                {result.linkError ? `: ${result.linkError}` : ""}. Add the link from Azure DevOps.
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                autoFocus
                onClick={() => void copy(`git fetch origin && git checkout ${result.branchName}`)}
                className="h-8 rounded-md border border-border bg-secondary px-3 text-sm font-medium hover:bg-accent"
              >
                Copy checkout command
              </button>
              <button
                type="button"
                onClick={() => void copy(result.branchName)}
                className="h-8 rounded-md border border-border px-3 text-sm hover:bg-secondary"
              >
                Copy branch name
              </button>
              <button
                type="button"
                onClick={onClose}
                className="h-8 rounded-md px-3 text-sm text-muted-foreground hover:bg-secondary"
              >
                Close
              </button>
              {copied ? <span className="text-xs text-muted-foreground">Copied.</span> : null}
            </div>
          </div>
        ) : (
          <form className="grid gap-3 p-4" onSubmit={submit}>
            <label className="grid gap-1.5">
              <span className={labelClass}>Branch name</span>
              <input
                ref={nameRef}
                value={branchName}
                onChange={(event) => setBranchName(event.target.value)}
                spellCheck={false}
                className={`${inputClass} font-mono`}
              />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1.5">
                <span className={labelClass}>Repository</span>
                <select
                  value={effectiveRepositoryId}
                  onChange={(event) => {
                    setRepositoryId(event.target.value);
                    setBaseBranch("");
                  }}
                  disabled={repositoriesQuery.isLoading}
                  className={inputClass}
                >
                  {repositories.map((repo) => (
                    <option key={repo.repositoryId} value={repo.repositoryId}>
                      {repo.repositoryName}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1.5">
                <span className={labelClass}>Base branch</span>
                <select
                  value={effectiveBase}
                  onChange={(event) => setBaseBranch(event.target.value)}
                  disabled={branchesQuery.isLoading}
                  className={inputClass}
                >
                  {branches.map((branch) => (
                    <option key={branch.name} value={branch.name}>
                      {branch.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {repositoriesQuery.isSuccess && repositories.length === 0 ? (
              <p className="text-sm text-muted-foreground">This project has no repositories.</p>
            ) : null}
            {mutation.isError ? (
              <p role="alert" className="text-sm text-destructive">
                {commandErrorMessage(mutation.error)}
              </p>
            ) : null}
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="h-8 rounded-md px-3 text-sm text-muted-foreground hover:bg-secondary"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={mutation.isPending || !effectiveRepositoryId || !effectiveBase}
                className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
                Create branch
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
