import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import {
  deleteOrganization,
  commandErrorMessage,
  type Organization,
} from '@/lib/azdoCommands';
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { SoftwareUpdateSettings } from "./SoftwareUpdateSettings";
import { RowColorRulesSettings } from "./RowColorRulesSettings";
import { SetupPanel } from './SetupPanel';
import { QuickPipelinesSettings } from './QuickPipelinesSettings';
import { SyncHealthSettings } from './SyncHealthSettings';
import { ThemeSettings } from './ThemeSettings';
import { DataCacheSettings } from './DataCacheSettings';
import { ValidationModeSettings } from './ValidationModeSettings';
import { DesktopNotificationSettings } from './DesktopNotificationSettings';
import { NotificationRulesSettings } from './NotificationRulesSettings';
import { ReviewResultFolderSettings } from './ReviewResultFolderSettings';
import { ReviewStaleThresholdSettings, WorkItemStaleThresholdSettings } from './StaleThresholdSettings';
import { ShowWindowHotkeySettings } from './ShowWindowHotkeySettings';
import { KeyboardShortcutSettings } from './KeyboardShortcutSettings';

export { SetupPanel } from './SetupPanel';
export { ReviewResultFolderSettings } from './ReviewResultFolderSettings';
export { ReviewStaleThresholdSettings, WorkItemStaleThresholdSettings } from './StaleThresholdSettings';
export { NotificationRulesSettings } from './NotificationRulesSettings';
export { ShowWindowHotkeySettings } from './ShowWindowHotkeySettings';

export function OrganizationSettings({
  organizations,
}: {
  organizations: Organization[];
}) {
  const queryClient = useQueryClient();
  const [pendingDelete, setPendingDelete] = useState<Organization | null>(null);
  const deleteMutation = useMutation({
    mutationFn: deleteOrganization,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["organizations"] });
    },
  });

  return (
    <div className="space-y-3">
      <SetupPanel compact />
      <ThemeSettings />
      <KeyboardShortcutSettings />
      <ShowWindowHotkeySettings />
      <DesktopNotificationSettings />
      <NotificationRulesSettings />
      <ReviewResultFolderSettings />
      <QuickPipelinesSettings organizations={organizations} />
      <ReviewStaleThresholdSettings />
      <WorkItemStaleThresholdSettings />
      <RowColorRulesSettings />
      <SyncHealthSettings organizations={organizations} />
      <DataCacheSettings />
      <SoftwareUpdateSettings />
      <ValidationModeSettings />
      <div className="overflow-hidden rounded-md border border-border bg-card">
        <div className="border-b border-border px-3 py-2">
          <h2 className="text-base font-semibold">Organizations</h2>
        </div>
        {deleteMutation.isError && (
          <p className="px-5 py-2 text-sm text-destructive">
            {commandErrorMessage(deleteMutation.error)}
          </p>
        )}
        <div className="divide-y divide-border">
          {organizations.map((organization) => (
            <div
              key={organization.id}
              className="grid items-center gap-4 px-3 py-2 md:grid-cols-[1fr_auto_auto_auto]"
            >
              <div>
                <p className="font-medium">{organization.name}</p>
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

function formatAuthProvider(value: string): string {
  return value === "azure_cli" ? "Azure CLI" : value.toUpperCase();
}
