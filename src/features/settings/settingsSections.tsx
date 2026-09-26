import type { ReactNode } from 'react';
import type { Organization } from '@/lib/azdoCommands';
import { SoftwareUpdateSettings } from "./SoftwareUpdateSettings";
import { RowColorRulesSettings } from "./RowColorRulesSettings";
import { SetupPanel } from './SetupPanel';
import { ConnectionsSettings } from './ConnectionsSettings';
import { QuickPipelinesSettings } from './QuickPipelinesSettings';
import { SyncHealthSettings } from './SyncHealthSettings';
import { ThemeSettings } from './ThemeSettings';
import { DataCacheSettings } from './DataCacheSettings';
import { ValidationModeSettings } from './ValidationModeSettings';
import { ExperimentalSettings } from './ExperimentalSettings';
import { ExperimentalUsageStats } from './ExperimentalUsageStats';
import { ExperimentalDiagnostics } from './ExperimentalDiagnostics';
import { DesktopNotificationSettings } from './DesktopNotificationSettings';
import { NotificationRulesSettings } from './NotificationRulesSettings';
import { ReviewResultFolderSettings } from './ReviewResultFolderSettings';
import { WorkItemResultFolderSettings } from './WorkItemResultFolderSettings';
import { ReviewStaleThresholdSettings, WorkItemStaleThresholdSettings } from './StaleThresholdSettings';
import { ShowWindowHotkeySettings } from './ShowWindowHotkeySettings';
import { KeyboardShortcutSettings } from './KeyboardShortcutSettings';
import type { ExperimentalFlagName } from './useExperimentalFlags';

export type SettingsEntry = {
  id: string;
  /** Matches the panel's own heading so filter results read the same. */
  title: string;
  /** Extra search terms for things the heading does not say. */
  keywords: string;
  /** Panels that only render while an experimental flag is on. */
  flag?: ExperimentalFlagName;
  render: (organizations: Organization[]) => ReactNode;
};

export type SettingsGroup = {
  id: string;
  label: string;
  entries: SettingsEntry[];
};

export const SETTINGS_GROUPS: SettingsGroup[] = [
  {
    id: "accounts",
    label: "Accounts",
    entries: [
      {
        id: "connections",
        title: "Connections",
        keywords: "organization active switch remove delete auth user",
        render: (organizations) => <ConnectionsSettings organizations={organizations} />,
      },
      {
        id: "add-connection",
        title: "Add connection",
        keywords: "connect organization azure devops github pat personal access token azure cli login",
        render: () => <SetupPanel compact />,
      },
    ],
  },
  {
    id: "appearance",
    label: "Appearance & keyboard",
    entries: [
      {
        id: "appearance",
        title: "Appearance",
        keywords: "theme dark light system color",
        render: () => <ThemeSettings />,
      },
      {
        id: "keyboard-shortcuts",
        title: "Keyboard shortcuts",
        keywords: "keybindings keys hotkey override shortcut",
        render: () => <KeyboardShortcutSettings />,
      },
      {
        id: "show-window-hotkey",
        title: "Show window hotkey",
        keywords: "global hotkey keyboard shortcut bring to front",
        render: () => <ShowWindowHotkeySettings />,
      },
    ],
  },
  {
    id: "notifications",
    label: "Notifications",
    entries: [
      {
        id: "desktop-notifications",
        title: "Desktop notifications",
        keywords: "toast alert review request vote reset reply assignment state change",
        render: () => <DesktopNotificationSettings />,
      },
      {
        id: "notification-rules",
        title: "Notification rules",
        keywords: "allow mute project repository filter condition",
        render: () => <NotificationRulesSettings />,
      },
    ],
  },
  {
    id: "workflow",
    label: "Views & workflow",
    entries: [
      {
        id: "review-result-previews",
        title: "Review result previews",
        keywords: "folder path html pull request pr",
        render: () => <ReviewResultFolderSettings />,
      },
      {
        id: "work-item-result-previews",
        title: "Work item result previews",
        keywords: "folder path html",
        render: () => <WorkItemResultFolderSettings />,
      },
      {
        id: "quick-pipelines",
        title: "Quick Pipelines",
        keywords: "pipeline run command palette build",
        render: (organizations) => <QuickPipelinesSettings organizations={organizations} />,
      },
      {
        id: "review-stale-threshold",
        title: "My Reviews",
        keywords: "stale threshold days pull request highlight",
        render: () => <ReviewStaleThresholdSettings />,
      },
      {
        id: "work-item-stale-threshold",
        title: "My Work Items",
        keywords: "stale threshold days highlight",
        render: () => <WorkItemStaleThresholdSettings />,
      },
      {
        id: "row-color-rules",
        title: "Row color rules",
        keywords: "grid highlight conditional color work item",
        render: () => <RowColorRulesSettings />,
      },
    ],
  },
  {
    id: "data",
    label: "Data & sync",
    entries: [
      {
        id: "sync-health",
        title: "Sync health",
        keywords: "background sync status last refresh error",
        render: (organizations) => <SyncHealthSettings organizations={organizations} />,
      },
      {
        id: "data-cache",
        title: "Data cache",
        keywords: "clear cached responses reset storage",
        render: () => <DataCacheSettings />,
      },
      {
        id: "software-update",
        title: "Software update",
        keywords: "version upgrade updater install",
        render: () => <SoftwareUpdateSettings />,
      },
    ],
  },
  {
    id: "advanced",
    label: "Advanced",
    entries: [
      {
        id: "validation-mode",
        title: "Validation mode",
        keywords: "read-only readonly block writes safe dry run",
        render: () => <ValidationModeSettings />,
      },
      {
        id: "experimental",
        title: "Experimental",
        keywords: "beta flags preview features",
        render: () => <ExperimentalSettings />,
      },
      {
        id: "usage-stats",
        title: "Usage stats",
        keywords: "experimental statistics votes counts",
        flag: "usageStats",
        render: () => <ExperimentalUsageStats />,
      },
      {
        id: "diagnostics",
        title: "Diagnostics",
        keywords: "experimental export logs support",
        flag: "diagnosticsExport",
        render: () => <ExperimentalDiagnostics />,
      },
    ],
  },
];

/**
 * Narrows the groups to entries matching every whitespace-separated term of
 * `query` (case-insensitive, against group label, panel title and keywords).
 * Entries hidden by `isVisible` are dropped first so a filter never "matches"
 * a panel that would render nothing. Groups left empty are removed.
 */
export function filterSettingsGroups(
  groups: SettingsGroup[],
  query: string,
  isVisible: (entry: SettingsEntry) => boolean = () => true,
): SettingsGroup[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  return groups
    .map((group) => ({
      ...group,
      entries: group.entries.filter((entry) => {
        if (!isVisible(entry)) return false;
        if (terms.length === 0) return true;
        const haystack = `${group.label} ${entry.title} ${entry.keywords}`.toLowerCase();
        return terms.every((term) => haystack.includes(term));
      }),
    }))
    .filter((group) => group.entries.length > 0);
}
