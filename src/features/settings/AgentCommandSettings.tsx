import { type FormEvent, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, Loader2 } from 'lucide-react';
import {
  commandErrorMessage,
  getAppSettings,
  updateAppSettings,
  type AgentKind,
} from '@/lib/azdoCommands';
import { settingsInput } from './settingsHelpers';

// The shell command behind "Run agent" on a result's agent notes.

// Mirror `DEFAULT_CLAUDE_COMMAND` / `DEFAULT_CODEX_COMMAND` in
// src-tauri/src/agent_notes/launch.rs, used when a command is empty.
const DEFAULT_CLAUDE_COMMAND =
  'claude -p "Read {guide} and handle the open notes in {notes}" --add-dir "{notes}" --dangerously-skip-permissions';
const DEFAULT_CODEX_COMMAND =
  'codex exec --skip-git-repo-check --sandbox workspace-write --add-dir "{notes}" "Read {guide} and handle the open notes in {notes}"';
const INPUT_CLASS =
  "h-9 rounded-md border border-input bg-background px-3 font-mono text-sm outline-none focus:ring-2 focus:ring-ring";
const MODEL_FIELDS = [
  { key: "claudeModel", label: "Claude Code model", placeholder: "CLI default (e.g. opus)" },
  { key: "claudeModelChoices", label: "More Claude Code models", placeholder: "claude-opus-4-1, …" },
  { key: "codexModel", label: "Codex model", placeholder: "CLI default (e.g. gpt-5.1)" },
  { key: "codexModelChoices", label: "More Codex models", placeholder: "gpt-5.1, gpt-5.1-mini, …" },
] as const;
type ModelKey = (typeof MODEL_FIELDS)[number]["key"];

export function AgentCommandSettings() {
  const queryClient = useQueryClient();
  const settingsQuery = useQuery({
    queryKey: ["appSettings"],
    queryFn: getAppSettings,
    staleTime: 5 * 60_000,
  });
  const [command, setCommand] = useState("");
  const [codexCommand, setCodexCommand] = useState("");
  const [defaultAgent, setDefaultAgent] = useState<AgentKind>("claude");
  const [workspace, setWorkspace] = useState("");
  const [models, setModels] = useState<Record<ModelKey, string>>({
    claudeModel: "",
    claudeModelChoices: "",
    codexModel: "",
    codexModelChoices: "",
  });

  useEffect(() => {
    setCommand(settingsQuery.data?.agentCommand ?? "");
  }, [settingsQuery.data?.agentCommand]);
  useEffect(() => {
    setCodexCommand(settingsQuery.data?.codexCommand ?? "");
  }, [settingsQuery.data?.codexCommand]);
  useEffect(() => {
    setDefaultAgent(settingsQuery.data?.defaultAgent === "codex" ? "codex" : "claude");
  }, [settingsQuery.data?.defaultAgent]);
  useEffect(() => {
    setWorkspace(settingsQuery.data?.agentWorkspacePath ?? "");
  }, [settingsQuery.data?.agentWorkspacePath]);
  useEffect(() => {
    const data = settingsQuery.data;
    setModels({
      claudeModel: data?.claudeModel ?? "",
      claudeModelChoices: data?.claudeModelChoices ?? "",
      codexModel: data?.codexModel ?? "",
      codexModelChoices: data?.codexModelChoices ?? "",
    });
  }, [settingsQuery.data]);

  const mutation = useMutation({
    mutationFn: updateAppSettings,
    onSuccess: (settings) => queryClient.setQueryData(["appSettings"], settings),
  });

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    mutation.mutate(
      settingsInput(settingsQuery.data, {
        agentCommand: command,
        codexCommand,
        defaultAgent: defaultAgent === "codex" ? "codex" : null,
        agentWorkspacePath: workspace,
        ...models,
      }),
    );
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
              Started by a request in the Agent panel (Ctrl+J), in the repository's clone inside
              the workspace folder (else the result folder). The panel can switch the agent for
              each request.
            </p>
          </div>
        </div>
      </div>

      <form className="grid max-w-xl gap-3 p-3" onSubmit={onSubmit}>
        <label className="grid gap-2">
          <span className="text-sm font-medium">Default agent</span>
          <select
            value={defaultAgent}
            onChange={(event) => setDefaultAgent(event.target.value as AgentKind)}
            className="h-9 w-40 rounded-md border border-input bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="claude">Claude Code</option>
            <option value="codex">Codex</option>
          </select>
        </label>

        <label className="grid gap-2">
          <span className="text-sm font-medium">Claude Code command</span>
          <input
            value={command}
            onChange={(event) => setCommand(event.target.value)}
            placeholder={DEFAULT_CLAUDE_COMMAND}
            className={INPUT_CLASS}
          />
        </label>

        <label className="grid gap-2">
          <span className="text-sm font-medium">Codex command</span>
          <input
            value={codexCommand}
            onChange={(event) => setCodexCommand(event.target.value)}
            placeholder={DEFAULT_CODEX_COMMAND}
            className={INPUT_CLASS}
          />
          <span className="text-xs text-muted-foreground">
            Placeholders: <code>{"{target}"}</code> (work-item / pull-request), <code>{"{id}"}</code>,{" "}
            <code>{"{notes}"}</code> (the item's notes folder), <code>{"{workspace}"}</code>,{" "}
            <code>{"{repo}"}</code> (the pull request's repository), <code>{"{guide}"}</code> (the
            agent guide). Notes are kept in the app data folder, outside the folder the agent
            starts in, so allow the agent to use it (e.g. <code>--add-dir {"{notes}"}</code>).
            Leave a command empty to use the default shown in it: Claude Code runs in the
            background without permission prompts; Codex runs sandboxed to the folder it starts
            in and the notes folder.
          </span>
        </label>

        <div className="grid gap-2">
          <div className="grid grid-cols-2 gap-x-3 gap-y-2">
            {MODEL_FIELDS.map(({ key, label, placeholder }) => (
              <label key={key} className="grid gap-1">
                <span className="text-sm font-medium">{label}</span>
                <input
                  value={models[key]}
                  onChange={(event) => setModels((prev) => ({ ...prev, [key]: event.target.value }))}
                  placeholder={placeholder}
                  className={INPUT_CLASS}
                />
              </label>
            ))}
          </div>
          <span className="text-xs text-muted-foreground">
            The model each agent starts with, passed as <code>--model</code> (Claude Code) or{" "}
            <code>-m</code> (Codex) after the command; empty leaves it to the agent's own setting.
            The Agent panel can pick another model for each request from these, the more models
            (comma-separated) and, for Claude Code, opus / sonnet / haiku.
          </span>
        </div>

        <label className="grid gap-2">
          <span className="text-sm font-medium">Workspace folder</span>
          <input
            value={workspace}
            onChange={(event) => setWorkspace(event.target.value)}
            placeholder="D:\src\workspace"
            className={INPUT_CLASS}
          />
          <span className="text-xs text-muted-foreground">
            One folder that holds your repository clones, one subfolder per repository name. The
            agent starts in the clone of the pull request's repository, or here when there is
            none. DevDeck never clones or checks anything out. Leave empty to start in the result
            folder.
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
