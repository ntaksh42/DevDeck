import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Loader2, Plus } from "lucide-react";
import { createPullRequest, commandErrorMessage } from "@/lib/azdoCommands";
import { openExternalUrl } from "@/lib/openExternal";

// Inline "create pull request" form for the PR search view (issue #387).
// Requires exactly one repository to be selected in the parent search filters
// so the source/target branches resolve to a single project + repository.
export function CreatePullRequestForm({
  organizationId,
  projectId,
  repositoryId,
  initialSourceBranch,
  onClose,
}: {
  organizationId?: string;
  projectId: string;
  repositoryId: string;
  initialSourceBranch?: string;
  onClose: () => void;
}) {
  const [sourceBranch, setSourceBranch] = useState(initialSourceBranch ?? "");
  const [targetBranch, setTargetBranch] = useState("main");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // A branch picked from the Branches panel after the form is already open.
  useEffect(() => {
    if (initialSourceBranch) setSourceBranch(initialSourceBranch);
  }, [initialSourceBranch]);

  const createMutation = useMutation({
    mutationFn: createPullRequest,
    onSuccess: (created) => {
      setValidationError(null);
      setNotice(`Created PR #${created.pullRequestId}.`);
      setTitle("");
      setDescription("");
      if (created.webUrl) {
        const webUrl = created.webUrl;
        window.setTimeout(() => openExternalUrl(webUrl), 0);
      }
    },
    onError: () => setValidationError(null),
  });

  function submit() {
    const trimmedTitle = title.trim();
    const trimmedSource = sourceBranch.trim();
    const trimmedTarget = targetBranch.trim();
    if (!trimmedTitle || !trimmedSource || !trimmedTarget) {
      setValidationError("Title, source branch, and target branch are required.");
      return;
    }
    if (trimmedSource === trimmedTarget) {
      setValidationError("Source and target branches must differ.");
      return;
    }
    setValidationError(null);
    createMutation.mutate({
      organizationId,
      projectId,
      repositoryId,
      sourceBranch: trimmedSource,
      targetBranch: trimmedTarget,
      title: trimmedTitle,
      description,
    });
  }

  const error =
    validationError ?? (createMutation.isError ? commandErrorMessage(createMutation.error) : null);

  return (
    <div className="grid gap-2 rounded-md border border-border bg-background p-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">New pull request</h3>
        <button
          type="button"
          onClick={onClose}
          className="rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          Close
        </button>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="grid gap-1">
          <span className="text-xs text-muted-foreground">Source branch</span>
          <input
            value={sourceBranch}
            onChange={(event) => setSourceBranch(event.target.value)}
            placeholder="feature/my-change"
            aria-label="Source branch"
            className="h-8 rounded-md border border-input bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
        </label>
        <label className="grid gap-1">
          <span className="text-xs text-muted-foreground">Target branch</span>
          <input
            value={targetBranch}
            onChange={(event) => setTargetBranch(event.target.value)}
            placeholder="main"
            aria-label="Target branch"
            className="h-8 rounded-md border border-input bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
        </label>
      </div>
      <label className="grid gap-1">
        <span className="text-xs text-muted-foreground">Title</span>
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          aria-label="Pull request title"
          className="h-8 rounded-md border border-input bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring"
        />
      </label>
      <label className="grid gap-1">
        <span className="text-xs text-muted-foreground">Description (optional)</span>
        <textarea
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          rows={3}
          aria-label="Pull request description"
          className="resize-y rounded-md border border-input bg-background px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-ring"
        />
      </label>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={createMutation.isPending}
          className="inline-flex h-8 items-center gap-1 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {createMutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Plus className="h-4 w-4" aria-hidden="true" />
          )}
          Create
        </button>
        {notice ? <span className="text-xs text-emerald-700 dark:text-emerald-400">{notice}</span> : null}
      </div>
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
