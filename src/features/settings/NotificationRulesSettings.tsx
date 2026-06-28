import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, Plus, Trash2 } from 'lucide-react';
import {
  commandErrorMessage,
  getAppSettings,
  updateAppSettings,
  NOTIFICATION_RULE_TYPES,
  type NotificationRule,
} from '@/lib/azdoCommands';
import { settingsInput } from './settingsHelpers';

// Comma-separated text <-> string[] for the project / repository filters. Empty
// segments are kept while editing; the backend trims and drops blanks on save.
function rulesListToText(values: string[]): string {
  return values.join(", ");
}
function rulesTextToList(text: string): string[] {
  return text.split(",").map((value) => value.trim());
}

export function NotificationRulesSettings() {
  const queryClient = useQueryClient();
  const settingsQuery = useQuery({
    queryKey: ["appSettings"],
    queryFn: getAppSettings,
    staleTime: 5 * 60_000,
  });
  const mutation = useMutation({
    mutationFn: updateAppSettings,
    onSuccess: (settings) => {
      queryClient.setQueryData(["appSettings"], settings);
    },
  });

  const savedRules = settingsQuery.data?.notificationRules;
  const [draft, setDraft] = useState<NotificationRule[]>([]);

  // Keep the editable draft in step with the server copy whenever it loads or
  // changes elsewhere.
  useEffect(() => {
    if (savedRules) setDraft(savedRules);
  }, [savedRules]);

  function toggleType(index: number, value: string) {
    setDraft((rules) =>
      rules.map((rule, i) =>
        i === index
          ? {
              ...rule,
              types: rule.types.includes(value)
                ? rule.types.filter((type) => type !== value)
                : [...rule.types, value],
            }
          : rule,
      ),
    );
  }

  function setListField(
    index: number,
    field: "projects" | "repositories",
    text: string,
  ) {
    setDraft((rules) =>
      rules.map((rule, i) =>
        i === index ? { ...rule, [field]: rulesTextToList(text) } : rule,
      ),
    );
  }

  function setMute(index: number, mute: boolean) {
    setDraft((rules) =>
      rules.map((rule, i) => (i === index ? { ...rule, mute } : rule)),
    );
  }

  function addRule() {
    setDraft((rules) => [
      ...rules,
      { types: [], projects: [], repositories: [], mute: false },
    ]);
  }

  function removeRule(index: number) {
    setDraft((rules) => rules.filter((_, i) => i !== index));
  }

  function save() {
    mutation.mutate(settingsInput(settingsQuery.data, { notificationRules: draft }));
  }

  const dirty = JSON.stringify(draft) !== JSON.stringify(savedRules ?? []);

  return (
    <div className="rounded-md border border-border bg-card">
      <div className="border-b border-border px-3 py-2">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-secondary">
            <Bell className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-base font-semibold">Notification rules</h2>
            <p className="text-sm text-muted-foreground">
              Allow rules deliver only matching desktop notifications. Mute rules
              suppress matching notifications and take precedence, so you can
              silence a noisy project/repository without allow-listing everything
              else. With no rules, the per-type toggles above apply. Repository
              filters apply to pull requests only.
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-3 p-3">
        {draft.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No rules — every enabled notification is delivered.
          </p>
        ) : (
          draft.map((rule, index) => (
            <div
              key={index}
              className="grid gap-2 rounded-md border border-border p-3"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium">Rule {index + 1}</span>
                  <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={rule.mute}
                      onChange={(event) => setMute(index, event.target.checked)}
                      className="h-3.5 w-3.5 cursor-pointer rounded border-input"
                    />
                    Mute matching notifications
                  </label>
                  <span
                    className={`rounded px-1.5 py-px text-[10px] font-medium ${
                      rule.mute
                        ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                        : "bg-secondary text-muted-foreground"
                    }`}
                  >
                    {rule.mute ? "Mute" : "Allow"}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => removeRule(index)}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive focus:outline-none focus:ring-2 focus:ring-ring"
                  aria-label={`Remove rule ${index + 1}`}
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>

              <fieldset className="grid gap-1">
                <legend className="text-xs font-medium text-muted-foreground">
                  Notification types (any if none selected)
                </legend>
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  {NOTIFICATION_RULE_TYPES.map((type) => (
                    <label
                      key={type.value}
                      className="flex cursor-pointer items-center gap-1.5 text-sm"
                    >
                      <input
                        type="checkbox"
                        checked={rule.types.includes(type.value)}
                        onChange={() => toggleType(index, type.value)}
                        className="h-3.5 w-3.5 cursor-pointer rounded border-input"
                      />
                      {type.label}
                    </label>
                  ))}
                </div>
              </fieldset>

              <label className="grid gap-1">
                <span className="text-xs font-medium text-muted-foreground">
                  Projects (comma separated; any if blank)
                </span>
                <input
                  value={rulesListToText(rule.projects)}
                  onChange={(event) =>
                    setListField(index, "projects", event.target.value)
                  }
                  placeholder="Platform, Mobile"
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                />
              </label>

              <label className="grid gap-1">
                <span className="text-xs font-medium text-muted-foreground">
                  Repositories (comma separated; pull requests only)
                </span>
                <input
                  value={rulesListToText(rule.repositories)}
                  onChange={(event) =>
                    setListField(index, "repositories", event.target.value)
                  }
                  placeholder="web-app, api"
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                />
              </label>
            </div>
          ))
        )}

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={addRule}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border px-3 text-sm font-medium hover:bg-secondary focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add rule
          </button>
          <button
            type="button"
            onClick={save}
            disabled={!dirty || mutation.isPending}
            className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Save rules
          </button>
        </div>

        {settingsQuery.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {commandErrorMessage(settingsQuery.error)}
          </p>
        ) : null}

        {mutation.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {commandErrorMessage(mutation.error)}
          </p>
        ) : null}

        {mutation.isSuccess && !dirty ? (
          <p className="text-sm text-green-700 dark:text-green-400">
            Notification rules saved.
          </p>
        ) : null}
      </div>
    </div>
  );
}
