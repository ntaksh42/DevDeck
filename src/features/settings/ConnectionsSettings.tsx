import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import {
  deleteOrganization,
  getActiveOrganization,
  setActiveOrganization,
  commandErrorMessage,
  type Organization,
} from '@/lib/azdoCommands';
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { formatAuthProvider } from './SetupPanel';

export function ConnectionsSettings({
  organizations,
}: {
  organizations: Organization[];
}) {
  const queryClient = useQueryClient();
  const [pendingDelete, setPendingDelete] = useState<Organization | null>(null);
  const activeQuery = useQuery({
    queryKey: ["activeOrganization"],
    queryFn: getActiveOrganization,
  });
  const activeId = activeQuery.data?.id ?? null;

  // Switching the active connection swaps the whole API-layer provider, so every
  // screen's data is stale: invalidate everything and refresh capabilities.
  const setActiveMutation = useMutation({
    mutationFn: setActiveOrganization,
    onSuccess: () => {
      void queryClient.invalidateQueries();
    },
  });
  const deleteMutation = useMutation({
    mutationFn: deleteOrganization,
    onSuccess: () => {
      void queryClient.invalidateQueries();
    },
  });

  return (
    <div className="overflow-hidden rounded-md border border-border bg-card">
      <div className="border-b border-border px-3 py-2">
        <h2 className="text-base font-semibold">Connections</h2>
        <p className="text-sm text-muted-foreground">
          The active connection determines which platform every screen shows.
        </p>
      </div>
      {deleteMutation.isError && (
        <p className="px-5 py-2 text-sm text-destructive">
          {commandErrorMessage(deleteMutation.error)}
        </p>
      )}
      {setActiveMutation.isError && (
        <p className="px-5 py-2 text-sm text-destructive">
          {commandErrorMessage(setActiveMutation.error)}
        </p>
      )}
      <div
        role="radiogroup"
        aria-label="Active connection"
        className="divide-y divide-border"
      >
        {organizations.map((organization) => (
          <div
            key={organization.id}
            className="grid items-center gap-4 px-3 py-2 md:grid-cols-[auto_1fr_auto_auto_auto]"
          >
            <input
              type="radio"
              name="active-connection"
              checked={organization.id === activeId}
              onChange={() => setActiveMutation.mutate(organization.id)}
              disabled={setActiveMutation.isPending}
              aria-label={`Use ${organization.displayName ?? organization.name}`}
              className="h-4 w-4"
            />
            <div>
              <p className="font-medium">
                {organization.displayName ?? organization.name}
                <span className="ml-2 rounded bg-secondary px-1.5 py-0.5 text-xs text-muted-foreground">
                  {organization.providerKind === "github" ? "GitHub" : "Azure DevOps"}
                </span>
              </p>
              <p className="text-sm text-muted-foreground">
                {organization.baseUrl}
              </p>
            </div>
            <div className="text-left text-sm md:text-right">
              <p className="text-muted-foreground">Auth</p>
              <p className="font-medium">
                {formatAuthProvider(organization.authProvider)}
              </p>
            </div>
            <div className="text-left text-sm md:text-right">
              <p className="text-muted-foreground">Authenticated user</p>
              <p className="font-medium">
                {organization.authenticatedUserDisplayName ?? "Unknown"}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setPendingDelete(organization)}
              disabled={deleteMutation.isPending}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
              aria-label={`Remove ${organization.name}`}
              title={`Remove ${organization.name}`}
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>
      {pendingDelete ? (
        <ConfirmDialog
          title="Remove organization"
          message={`Remove "${pendingDelete.name}"? This deletes its stored credential and cannot be undone.`}
          confirmLabel="Remove"
          destructive
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => {
            deleteMutation.mutate({ id: pendingDelete.id });
            setPendingDelete(null);
          }}
        />
      ) : null}
    </div>
  );
}
