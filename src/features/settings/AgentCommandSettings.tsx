import { type FormEvent, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, Loader2 } from 'lucide-react';
import {
  commandErrorMessage,
  getAppSettings,
  updateAppSettings,
} from '@/lib/azdoCommands';
import { settingsInput } from './settingsHelpers';

// The shell command behind "Run agent" on a result's agent notes.
export function AgentCommandSettings() {
  const queryClient = useQueryClient();
  const settingsQuery = useQuery({
    queryKey: ["appSettings"],
    queryFn: getAppSettings,
    staleTime: 5 * 60_000,
  });
  const [command, setCommand] = useState("");

  useEffect(() => {
    setCommand(settingsQuery.data?.agentCommand ?? "");
  }, [settingsQuery.data?.agentCommand]);

  const mutation = useMutation({
    mutationFn: updateAppSettings,
    onSuccess: (settings) => queryClient.setQueryData(["appSettings"], settings),
  });

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    mutation.mutate(settingsInput(settingsQuery.data, { agentCommand: command }));
  }

  return (
    <div className="rounded-md border border-border bg-card">
      <div className="border-b border-border px-3 py-2">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-secondary">
            <Bot className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-base font-semibold">Agent command</h2>
            <p className="text-sm text-muted-foreground">
              Started by "Run agent" (A) in a result's agent notes, from the result folder.
            </p>
          </div>
        </div>
      </div>

      <form className="grid max-w-xl gap-3 p-3" onSubmit={onSubmit}>
        <label className="grid gap-2">
          <span className="text-sm font-medium">Command</span>
          <input
            value={command}
            onChange={(event) => setCommand(event.target.value)}
            placeholder='claude -p "Handle the open notes in {notes}"'
            className="h-9 rounded-md border border-input bg-background px-3 font-mono text-sm outline-none focus:ring-2 focus:ring-ring"
          />
          <span className="text-xs text-muted-foreground">
            Placeholders: <code>{"{target}"}</code> (work-item / pull-request), <code>{"{id}"}</code>,{" "}
            <code>{"{notes}"}</code> (the item's notes folder). Leave empty to hide Run agent.
          </span>
        </label>

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
        {mutation.isSuccess ? (
          <p className="text-sm text-green-700 dark:text-green-400">Agent command saved.</p>
        ) : null}

        <div>
          <button
            type="submit"
            disabled={settingsQuery.isLoading || mutation.isPending}
            className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {mutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Bot className="h-4 w-4" aria-hidden="true" />
            )}
            Save
          </button>
        </div>
      </form>
    </div>
  );
}
