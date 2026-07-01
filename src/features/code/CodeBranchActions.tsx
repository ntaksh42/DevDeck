import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import {
  createBranch,
  deleteBranch,
  commandErrorMessage,
  type RepoBranch,
} from "@/lib/azdoCommands";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import type { RepoOption } from "./codeBrowseShared";

// Branch create/delete controls next to the branch selector in CodeBrowseView.
// Create opens a small inline form (name + source branch); delete confirms via
// the shared ConfirmDialog before calling the API.
export function CodeBranchActions({
  organizationId,
  repo,
  branches,
  currentBranch,
  onBranchCreated,
}: {
  organizationId: string;
  repo: RepoOption;
  branches: RepoBranch[];
  currentBranch: string;
  onBranchCreated: (name: string) => void;
}) {
  const queryClient = useQueryClient();
  const branchesKey = ["repoBranches", organizationId, repo.projectId, repo.repositoryId];

  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [sourceBranch, setSourceBranch] = useState(currentBranch);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const newBranchButtonRef = useRef<HTMLButtonElement>(null);
  const formRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!creating) return;
    setSourceBranch(currentBranch);
    setNewName("");
    const raf = window.requestAnimationFrame(() => nameInputRef.current?.focus());
    return () => window.cancelAnimationFrame(raf);
  }, [creating, currentBranch]);

  // Close on an outside click, same convention as FilterableSelect.
  useEffect(() => {
    if (!creating) return;
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (!formRef.current?.contains(target) && target !== newBranchButtonRef.current) {
        setCreating(false);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [creating]);

  const createMutation = useMutation({
    mutationFn: () =>
      createBranch({
        organizationId,
        project: repo.projectId,
        repository: repo.repositoryId,
        sourceBranch,
        newBranchName: newName.trim(),
      }),
    onSuccess: (created) => {
      void queryClient.invalidateQueries({ queryKey: branchesKey });
      setCreating(false);
      onBranchCreated(created.name);
      newBranchButtonRef.current?.focus();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (branch: string) =>
      deleteBranch({
        organizationId,
        project: repo.projectId,
        repository: repo.repositoryId,
        branch,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: branchesKey });
      setPendingDelete(null);
    },
  });

  function closeCreateForm() {
    setCreating(false);
    newBranchButtonRef.current?.focus();
  }

  function onFormKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeCreateForm();
    }
  }

  function submitCreate() {
    if (!newName.trim() || createMutation.isPending) return;
    createMutation.mutate();
  }

  const currentIsDefault = branches.find((item) => item.name === currentBranch)?.isDefault ?? false;

  return (
    <div className="relative flex shrink-0 items-center gap-1">
      <button
        ref={newBranchButtonRef}
        type="button"
        onClick={() => setCreating((open) => !open)}
        aria-label="New branch"
        aria-expanded={creating}
        title="New branch"
        className="flex h-9 w-9 items-center justify-center rounded-md border border-input text-muted-foreground hover:text-foreground"
      >
        <Plus className="h-4 w-4" aria-hidden="true" />
      </button>
      <button
        type="button"
        onClick={() => setPendingDelete(currentBranch)}
        disabled={!currentBranch || currentIsDefault}
        aria-label="Delete branch"
        title={currentIsDefault ? "The default branch cannot be deleted" : "Delete branch"}
        className="flex h-9 w-9 items-center justify-center rounded-md border border-input text-muted-foreground hover:text-foreground disabled:opacity-40"
      >
        <Trash2 className="h-4 w-4" aria-hidden="true" />
      </button>

      {creating ? (
        <div
          ref={formRef}
          role="dialog"
          aria-label="Create branch"
          onKeyDown={onFormKeyDown}
          className="absolute right-0 top-full z-20 mt-1 w-72 rounded-md border border-border bg-card p-3 shadow-lg"
        >
          <label className="block text-xs font-medium text-muted-foreground" htmlFor="new-branch-name">
            New branch name
          </label>
          <input
            ref={nameInputRef}
            id="new-branch-name"
            type="text"
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                submitCreate();
              }
            }}
            className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
          <label
            className="mt-2 block text-xs font-medium text-muted-foreground"
            htmlFor="new-branch-source"
          >
            From branch
          </label>
          <select
            id="new-branch-source"
            value={sourceBranch}
            onChange={(event) => setSourceBranch(event.target.value)}
            className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          >
            {branches.map((item) => (
              <option key={item.name} value={item.name}>
                {item.name}
              </option>
            ))}
          </select>
          {createMutation.isError ? (
            <p className="mt-2 text-xs text-destructive">
              {commandErrorMessage(createMutation.error)}
            </p>
          ) : null}
          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              onClick={closeCreateForm}
              className="rounded-md border border-border bg-card px-3 py-1.5 text-sm font-medium hover:bg-secondary focus:outline-none focus:ring-2 focus:ring-ring"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={submitCreate}
              disabled={!newName.trim() || createMutation.isPending}
              className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
            >
              Create
            </button>
          </div>
        </div>
      ) : null}

      {pendingDelete ? (
        <ConfirmDialog
          title="Delete branch"
          message={`Delete branch "${pendingDelete}"? This cannot be undone.`}
          confirmLabel="Delete"
          destructive
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => deleteMutation.mutate(pendingDelete)}
        />
      ) : null}
      {deleteMutation.isError ? (
        <p className="absolute right-0 top-full z-20 mt-1 w-64 rounded-md border border-destructive/40 bg-card p-2 text-xs text-destructive shadow-lg">
          {commandErrorMessage(deleteMutation.error)}
        </p>
      ) : null}
    </div>
  );
}
