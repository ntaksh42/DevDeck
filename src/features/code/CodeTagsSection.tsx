import { type KeyboardEvent as ReactKeyboardEvent, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  commandErrorMessage,
  deleteRepoTag,
  listRepoTagOverview,
  type TagOverviewItem,
} from "@/lib/azdoCommands";
import { ConfirmDialog, useConfirm } from "@/components/ConfirmDialog";
import { handleRowNavKey, type RepoOption } from "./codeBrowseShared";

export const repoTagOverviewKey = (organizationId: string, repositoryId: string) =>
  ["repoTagOverview", organizationId, repositoryId] as const;

// The Tags list under the Files > Branches table: each tag with the commit it
// points at. Tags are created from a branch row ("Tag"); here they can be
// deleted (guarded on the tag still pointing where it did when listed).
export function CodeTagsSection({
  organizationId,
  repo,
}: {
  organizationId: string;
  repo: RepoOption;
}) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: repoTagOverviewKey(organizationId, repo.repositoryId),
    queryFn: () =>
      listRepoTagOverview({
        organizationId,
        project: repo.projectId,
        repository: repo.repositoryId,
      }),
    staleTime: 60_000,
  });
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const { confirm, dialogProps } = useConfirm();
  const containerRef = useRef<HTMLDivElement | null>(null);

  const deleteTag = useMutation({
    mutationFn: (tag: TagOverviewItem) =>
      deleteRepoTag({
        organizationId,
        project: repo.projectId,
        repository: repo.repositoryId,
        name: tag.name,
        objectId: tag.objectId as string,
      }),
    onSuccess: () => {
      setDeleteError(null);
      void queryClient.invalidateQueries({
        queryKey: repoTagOverviewKey(organizationId, repo.repositoryId),
      });
    },
    onError: (error) => setDeleteError(commandErrorMessage(error)),
  });

  function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    handleRowNavKey(event, containerRef.current, "[data-tag-item]");
  }

  const tags = query.data ?? [];
  return (
    <div ref={containerRef} onKeyDown={onKeyDown} className="mt-3 border-t border-border">
      <h3 className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Tags{query.data ? ` (${tags.length})` : ""}
      </h3>
      {query.isError ? (
        <div role="alert" className="px-3 py-1 text-xs text-destructive">
          {commandErrorMessage(query.error)}
        </div>
      ) : query.isLoading ? (
        <div className="px-3 py-1 text-sm text-muted-foreground">Loading…</div>
      ) : tags.length === 0 ? (
        <div className="px-3 py-1 text-sm text-muted-foreground">
          No tags. Use &quot;Tag&quot; on a branch to create one.
        </div>
      ) : (
        <table className="w-full text-sm">
          <tbody>
            {tags.map((tag) => (
              <tr key={tag.name} className="border-b border-border/60 hover:bg-muted/50">
                <td className="px-3 py-1.5">
                  <button
                    type="button"
                    data-tag-item
                    className="text-left font-medium focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    {tag.name}
                  </button>
                </td>
                <td className="px-3 py-1.5 font-mono text-xs text-muted-foreground">
                  {tag.commitId ? tag.commitId.slice(0, 8) : ""}
                </td>
                <td className="whitespace-nowrap px-3 py-1.5 text-right">
                  {tag.objectId ? (
                    <button
                      type="button"
                      disabled={deleteTag.isPending}
                      onClick={() =>
                        confirm({
                          title: "Delete tag",
                          message: `Delete tag ${tag.name}?`,
                          confirmLabel: "Delete",
                          destructive: true,
                          onConfirm: () => deleteTag.mutate(tag),
                        })
                      }
                      className="text-xs text-destructive hover:underline disabled:opacity-50"
                      title={`Delete ${tag.name}`}
                    >
                      Delete tag
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {deleteError ? (
        <div role="alert" className="px-3 py-1 text-xs text-destructive">
          {deleteError}
        </div>
      ) : null}
      {dialogProps ? <ConfirmDialog {...dialogProps} /> : null}
    </div>
  );
}
