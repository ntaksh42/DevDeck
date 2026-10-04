import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  commandErrorMessage,
  createPullRequest,
  type CreatedPullRequest,
} from "@/lib/azdoCommands";
import type { RepoOption } from "./codeBrowseShared";

const INPUT_CLASS =
  "w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring";

// Opens a pull request from a source branch into a target branch. The title
// starts from the source branch's last commit message. Esc or Cancel closes it,
// Ctrl+Enter submits from the description, and focus goes back to whatever
// opened it.
export function CreatePullRequestDialog({
  organizationId,
  repo,
  branches,
  initialSource,
  initialTarget,
  initialTitle,
  onClose,
  onCreated,
}: {
  organizationId: string;
  repo: RepoOption;
  branches: string[];
  initialSource: string;
  initialTarget: string;
  initialTitle: string;
  onClose: () => void;
  onCreated: (pullRequest: CreatedPullRequest) => void;
}) {
  const [source, setSource] = useState(initialSource);
  const [target, setTarget] = useState(initialTarget);
  const [title, setTitle] = useState(initialTitle);
  const [description, setDescription] = useState("");
  const [isDraft, setIsDraft] = useState(false);
  const titleRef = useRef<HTMLInputElement | null>(null);

  const create = useMutation({
    mutationFn: () =>
      createPullRequest({
        organizationId,
        projectId: repo.projectId,
        repositoryId: repo.repositoryId,
        sourceBranch: source,
        targetBranch: target,
        title,
        description,
        isDraft,
      }),
    onSuccess: onCreated,
  });

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    titleRef.current?.focus();
    titleRef.current?.select();
    return () => {
      window.setTimeout(() => opener?.focus(), 0);
    };
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !create.isPending) {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    }
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [onClose, create.isPending]);

  const canSubmit = title.trim() !== "" && source !== "" && target !== "" && source !== target;

  function submit(event?: { preventDefault: () => void }) {
    event?.preventDefault();
    if (canSubmit && !create.isPending) create.mutate();
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !create.isPending) onClose();
      }}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-label="Create pull request"
        onSubmit={submit}
        onKeyDown={(event) => {
          // Keep arrows/Enter inside the dialog so the grid underneath ignores them.
          if (event.key !== "Tab" && event.key !== "Escape") event.stopPropagation();
        }}
        className="flex w-full max-w-lg flex-col gap-3 rounded-md border border-border bg-card p-4 shadow-lg"
      >
        <h2 className="text-base font-semibold text-foreground">
          Create pull request
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            {repo.projectName} / {repo.repositoryName}
          </span>
        </h2>
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            From
            <select
              value={source}
              onChange={(event) => setSource(event.target.value)}
              className={INPUT_CLASS}
            >
              {branches.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Into
            <select
              value={target}
              onChange={(event) => setTarget(event.target.value)}
              className={INPUT_CLASS}
            >
              {branches.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        </div>
        {source === target ? (
          <p role="alert" className="text-xs text-destructive">
            Pick two different branches.
          </p>
        ) : null}
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Title
          <input
            ref={titleRef}
            type="text"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            className={INPUT_CLASS}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Description (optional)
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                submit();
              }
            }}
            rows={5}
            className={INPUT_CLASS}
          />
        </label>
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            checked={isDraft}
            onChange={(event) => setIsDraft(event.target.checked)}
          />
          Create as draft
        </label>
        {create.isError ? (
          <p role="alert" className="text-xs text-destructive">
            {commandErrorMessage(create.error)}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={create.isPending}
            className="rounded-md border border-border bg-card px-3 py-1.5 text-sm font-medium hover:bg-secondary focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!canSubmit || create.isPending}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
          >
            {create.isPending ? "Creating…" : "Create"}
          </button>
        </div>
      </form>
    </div>
  );
}
