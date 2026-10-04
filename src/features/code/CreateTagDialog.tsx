import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { commandErrorMessage, createRepoTag } from "@/lib/azdoCommands";
import type { RepoOption } from "./codeBrowseShared";

// Creates a lightweight tag at a branch's tip commit. Enter creates, Esc or
// Cancel closes, and focus returns to whatever opened it.
export function CreateTagDialog({
  organizationId,
  repo,
  sourceName,
  commitId,
  onClose,
  onCreated,
}: {
  organizationId: string;
  repo: RepoOption;
  sourceName: string;
  commitId: string;
  onClose: () => void;
  onCreated: (name: string) => void;
}) {
  const [name, setName] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  const create = useMutation({
    mutationFn: (tagName: string) =>
      createRepoTag({
        organizationId,
        project: repo.projectId,
        repository: repo.repositoryId,
        name: tagName,
        commitId,
      }),
    onSuccess: (_result, tagName) => onCreated(tagName),
  });

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    inputRef.current?.focus();
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

  const trimmed = name.trim();

  function submit(event: { preventDefault: () => void }) {
    event.preventDefault();
    if (trimmed && !create.isPending) create.mutate(trimmed);
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
        aria-label="Create tag"
        onSubmit={submit}
        onKeyDown={(event) => {
          if (event.key !== "Tab" && event.key !== "Escape") event.stopPropagation();
        }}
        className="flex w-full max-w-sm flex-col gap-3 rounded-md border border-border bg-card p-4 shadow-lg"
      >
        <h2 className="text-base font-semibold text-foreground">Create tag</h2>
        <p className="text-xs text-muted-foreground">
          At the tip of <span className="font-mono text-foreground">{sourceName}</span> (
          <span className="font-mono">{commitId.slice(0, 8)}</span>) in {repo.projectName} /{" "}
          {repo.repositoryName}
        </p>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          New tag name
          <input
            ref={inputRef}
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="v1.2.0"
            className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
          />
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
            disabled={!trimmed || create.isPending}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
          >
            {create.isPending ? "Creating…" : "Create"}
          </button>
        </div>
      </form>
    </div>
  );
}
