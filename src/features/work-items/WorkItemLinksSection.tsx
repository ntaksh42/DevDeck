import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, X } from "lucide-react";
import type { WorkItemLinkType, WorkItemPreview } from "@/lib/azdoCommands";
import { addWorkItemLink, commandErrorMessage, removeWorkItemLink } from "@/lib/azdoCommands";
import { openExternalUrl } from "@/lib/openExternal";
import { workItemQueryKeys } from "./queryKeys";
import { REMOVABLE_LINK_TYPES, WORK_ITEM_LINK_TYPES } from "./workItemPreviewHelpers";
import { WorkItemStatePill, WorkItemTypeBadge } from "./WorkItemBadges";
import { PreviewSection } from "./PreviewSection";

export function WorkItemLinksSection({ preview }: { preview: WorkItemPreview }) {
  const linkQueryClient = useQueryClient();
  const [newLinkType, setNewLinkType] = useState<WorkItemLinkType>("Related");
  const [newLinkTargetId, setNewLinkTargetId] = useState("");
  const [linkError, setLinkError] = useState<string | null>(null);

  function invalidatePreview() {
    void linkQueryClient.invalidateQueries({ queryKey: workItemQueryKeys.previewRoot() });
  }

  const addLinkMutation = useMutation({
    mutationFn: addWorkItemLink,
    onSuccess: () => {
      setLinkError(null);
      setNewLinkTargetId("");
      invalidatePreview();
    },
    onError: (mutationError) => setLinkError(commandErrorMessage(mutationError)),
  });
  const removeLinkMutation = useMutation({
    mutationFn: removeWorkItemLink,
    onSuccess: () => {
      setLinkError(null);
      invalidatePreview();
    },
    onError: (mutationError) => setLinkError(commandErrorMessage(mutationError)),
  });
  const linkMutationPending = addLinkMutation.isPending || removeLinkMutation.isPending;

  function submitNewLink() {
    const targetId = Number.parseInt(newLinkTargetId.trim(), 10);
    if (!Number.isFinite(targetId) || targetId <= 0) {
      setLinkError("Enter a valid work item id.");
      return;
    }
    addLinkMutation.mutate({
      organizationId: preview.organizationId,
      projectId: preview.projectId,
      workItemId: preview.id,
      targetId,
      linkType: newLinkType,
    });
  }

  return (
    <PreviewSection className="mt-2" collapseId="links" title={`Links (${preview.relations.length})`}>
      <div className="space-y-1">
        {preview.relations.map((relation) => (
          <div key={`${relation.relationType}:${relation.id}`} className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => {
                if (relation.webUrl) openExternalUrl(relation.webUrl);
              }}
              className="flex min-w-0 flex-1 items-center gap-1.5 rounded border border-border bg-card px-1.5 py-1 text-left text-xs hover:bg-secondary"
              title={relation.webUrl ?? undefined}
            >
              <span className="w-16 shrink-0 truncate text-[11px] text-muted-foreground">
                {relation.relationType}
              </span>
              {relation.workItemType ? (
                <WorkItemTypeBadge type={relation.workItemType} />
              ) : null}
              <span className="shrink-0 font-mono text-[11px] text-primary">
                #{relation.id}
              </span>
              <span className="min-w-0 flex-1 truncate">
                {relation.title ?? "(unresolved)"}
              </span>
              {relation.state ? <WorkItemStatePill state={relation.state} /> : null}
            </button>
            {REMOVABLE_LINK_TYPES.has(relation.relationType) ? (
              <button
                type="button"
                disabled={linkMutationPending}
                onClick={() =>
                  removeLinkMutation.mutate({
                    organizationId: preview.organizationId,
                    projectId: preview.projectId,
                    workItemId: preview.id,
                    targetId: relation.id,
                    linkType: relation.relationType as WorkItemLinkType,
                  })
                }
                aria-label={`Remove ${relation.relationType} link to #${relation.id}`}
                title="Remove link"
                className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-destructive disabled:opacity-50"
              >
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
            ) : null}
          </div>
        ))}
      </div>
      {/* relative: contain the absolutely-positioned sr-only label; without a
          positioned ancestor it escapes every overflow clip and stretches the
          document scroll area (window scrollbar bug). */}
      <div className="relative mt-1.5 flex items-center gap-1">
        <label className="sr-only" htmlFor="add-link-type">
          Link type
        </label>
        <select
          id="add-link-type"
          value={newLinkType}
          onChange={(event) => setNewLinkType(event.target.value as WorkItemLinkType)}
          className="h-7 rounded border border-input bg-background px-1 text-[11px] outline-none focus:ring-2 focus:ring-ring"
        >
          {WORK_ITEM_LINK_TYPES.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
        <input
          value={newLinkTargetId}
          onChange={(event) => setNewLinkTargetId(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              event.stopPropagation();
              submitNewLink();
            }
          }}
          inputMode="numeric"
          placeholder="Work item #"
          aria-label="Link target work item id"
          className="h-7 w-24 rounded border border-input bg-background px-1.5 text-[11px] outline-none focus:ring-2 focus:ring-ring"
        />
        <button
          type="button"
          disabled={linkMutationPending || !newLinkTargetId.trim()}
          onClick={submitNewLink}
          className="inline-flex items-center gap-0.5 rounded border border-border px-1.5 py-0.5 text-[11px] hover:bg-accent disabled:opacity-50"
        >
          <Plus className="h-3 w-3" aria-hidden="true" /> Add
        </button>
      </div>
      {linkError ? (
        <p role="alert" className="mt-1 text-[11px] text-destructive">
          {linkError}
        </p>
      ) : null}
    </PreviewSection>
  );
}
