import { type FormEvent, type ReactNode, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, Loader2 } from 'lucide-react';
import {
  commandErrorMessage,
  getAppSettings,
  updateAppSettings,
  type AgentKind,
} from '@/lib/azdoCommands';
import { settingsInput } from './settingsHelpers';
import {
  AUTO_AGENT_MAX_PER_SYNC_MAX,
  AUTO_AGENT_MAX_PER_SYNC_MIN,
  DEFAULT_AUTO_AGENT_MAX_PER_SYNC,
} from '@/lib/reviewSettings';

// The shell command behind "Run agent" on a result's agent notes.

// Mirror `DEFAULT_CLAUDE_COMMAND` / `DEFAULT_CODEX_COMMAND` in
// src-tauri/src/agent_notes/launch.rs, used when a command is empty.
const DEFAULT_CLAUDE_COMMAND =
  'claude -p "Read {guide} and handle the open notes in {notes}" --add-dir "{notes}" "{results}" --dangerously-skip-permissions';
const DEFAULT_CODEX_COMMAND =
  'codex exec --skip-git-repo-check --sandbox workspace-write -c sandbox_workspace_write.network_access=true --add-dir "{notes}" --add-dir "{results}" "Read {guide} and handle the open notes in {notes}"';
const INPUT_CLASS =
  "h-9 rounded-md border border-input bg-background px-3 font-mono text-sm outline-none focus:ring-2 focus:ring-ring";
const MODEL_FIELDS = [
  { key: "claudeModel", label: "Claude Code model", placeholder: "CLI default (e.g. opus)" },
  { key: "claudeModelChoices", label: "More Claude Code models", placeholder: "claude-opus-4-1, …" },
  { key: "codexModel", label: "Codex model", placeholder: "CLI default (e.g. gpt-5.1)" },
  { key: "codexModelChoices", label: "More Codex models", placeholder: "gpt-5.1, gpt-5.1-mini, …" },
] as const;
type ModelKey = (typeof MODEL_FIELDS)[number]["key"];
import { SettingsRow } from './SettingsRow';

/** One line of help; the rest stays folded behind "Details". */
function Help({ summary, children }: { summary: ReactNode; children: ReactNode }) {
  return (
    <div className="text-xs text-muted-foreground">
      <p>{summary}</p>
      <details>
        <summary className="w-fit cursor-pointer rounded hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          Details
        </summary>
        <p className="mt-1">{children}</p>
      </details>
    </div>
  );
}

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
  const [autoPost, setAutoPost] = useState(false);
  const [insightEnabled, setInsightEnabled] = useState(false);
  const [insightModel, setInsightModel] = useState("");
  const [insightMax, setInsightMax] = useState(3);
  const [autoAgent, setAutoAgent] = useState(false);
  const [autoAgentMax, setAutoAgentMax] = useState(DEFAULT_AUTO_AGENT_MAX_PER_SYNC);
  const [autoAgentInterval, setAutoAgentInterval] = useState(15);
  const [autoPipelines, setAutoPipelines] = useState(false);
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
    setAutoPost(settingsQuery.data?.agentAutoPostEnabled ?? false);
  }, [settingsQuery.data?.agentAutoPostEnabled]);
  useEffect(() => {
    setWorkspace(settingsQuery.data?.agentWorkspacePath ?? "");
  }, [settingsQuery.data?.agentWorkspacePath]);
  useEffect(() => {
    setInsightEnabled(settingsQuery.data?.inboxInsightEnabled ?? false);
    setInsightModel(settingsQuery.data?.inboxInsightModel ?? "");
    setInsightMax(settingsQuery.data?.inboxInsightMaxPerSync ?? 3);
  }, [
    settingsQuery.data?.inboxInsightEnabled,
    settingsQuery.data?.inboxInsightModel,
    settingsQuery.data?.inboxInsightMaxPerSync,
  ]);
  useEffect(() => {
    setAutoAgent(settingsQuery.data?.autoAgentEnabled ?? false);
    setAutoAgentMax(settingsQuery.data?.autoAgentMaxPerSync ?? DEFAULT_AUTO_AGENT_MAX_PER_SYNC);
    setAutoAgentInterval(settingsQuery.data?.autoAgentIntervalMinutes ?? 15);
  }, [
    settingsQuery.data?.autoAgentEnabled,
    settingsQuery.data?.autoAgentMaxPerSync,
    settingsQuery.data?.autoAgentIntervalMinutes,
  ]);
  useEffect(() => {
    setAutoPipelines(settingsQuery.data?.autoAgentPipelinesEnabled ?? false);
  }, [settingsQuery.data?.autoAgentPipelinesEnabled]);
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
        agentAutoPostEnabled: autoPost,
        agentWorkspacePath: workspace,
        inboxInsightEnabled: insightEnabled,
        inboxInsightModel: insightModel,
        inboxInsightMaxPerSync: insightMax,
        autoAgentEnabled: autoAgent,
        autoAgentMaxPerSync: autoAgentMax,
        autoAgentIntervalMinutes: autoAgentInterval,
        autoAgentPipelinesEnabled: autoPipelines,
        ...models,
      }),
    );
  }

  return (
    <SettingsRow
      title="Agent command"
      description={<>Runs requests from the Agent panel (Ctrl+J). The panel can switch the agent for each request.</>}
    >
      <form className="grid max-w-xl gap-3" onSubmit={onSubmit}>
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
        </label>

        <Help summary="Leave a command empty to use the default shown in it.">
          Placeholders: <code>{"{target}"}</code> (work-item / pull-request), <code>{"{id}"}</code>,{" "}
          <code>{"{notes}"}</code> (the item's notes folder), <code>{"{workspace}"}</code>,{" "}
          <code>{"{repo}"}</code> (the pull request's repository), <code>{"{results}"}</code> (the result folder),{" "}
          <code>{"{guide}"}</code> (the agent guide). Notes are kept in the app data folder, outside the folder the
          agent starts in, so allow the agent to use it (e.g. <code>--add-dir {"{notes}"}</code>). By default
          Claude Code runs in the background without permission prompts; Codex runs sandboxed to the folder it
          starts in and the notes folder.
        </Help>

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
          <Help summary="Empty uses the agent's own model. More models are comma-separated choices for the Agent panel.">
            The model is passed as <code>--model</code> (Claude Code) or <code>-m</code> (Codex) after the
            command. The Agent panel can pick another model for each request from these and, for Claude Code,
            opus / sonnet / haiku.
          </Help>
        </div>

        <div className="grid gap-2">
          <label className="grid gap-2">
            <span className="text-sm font-medium">Workspace folder</span>
            <input
              value={workspace}
              onChange={(event) => setWorkspace(event.target.value)}
              placeholder="D:\src\workspace"
              className={INPUT_CLASS}
            />
          </label>
          <Help summary="Holds your repository clones, one subfolder per repository name. Empty starts in the result folder.">
            The agent starts in the clone of the pull request's repository, or here when there is none.
            DevDeck only clones for automatic reviews: a missing clone is made shallow, and moved to the PR's
            latest commit before each run. A folder you cloned yourself is never touched.
          </Help>
        </div>

        <div className="grid gap-2">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              checked={autoPost}
              onChange={(event) => setAutoPost(event.target.checked)}
              className="h-4 w-4"
            />
            Post the comments agents propose without asking each time
          </label>
          <Help summary="Off: you post each one with C in the Agent panel. A comment with a link or @mention always waits for you.">
            An agent has no Azure DevOps access; it writes a proposed comment into the note and DevDeck posts
            it with your account. On: comments are posted as they appear for the work item / pull request the
            panel is showing, at most 3 per item and 10 per hour, never the same text twice. Read-only
            validation mode never posts.
          </Help>
        </div>

        <div className="grid gap-2">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              checked={insightEnabled}
              onChange={(event) => setInsightEnabled(event.target.checked)}
              className="h-4 w-4"
            />
            Write decision notes for new Inbox items with Claude Code
          </label>
          <label className="grid gap-1">
            <span className="text-sm font-medium">Inbox notes model</span>
            <input
              value={insightModel}
              onChange={(event) => setInsightModel(event.target.value)}
              placeholder="sonnet"
              className={`${INPUT_CLASS} w-60`}
            />
          </label>
          <label className="grid gap-1">
            <span className="text-sm font-medium">Notes per sync</span>
            <input
              type="number"
              min={1}
              max={10}
              value={insightMax}
              onChange={(event) => setInsightMax(Number(event.target.value) || 3)}
              className={`${INPUT_CLASS} w-24`}
            />
          </label>
          <Help summary="After each sync, a verdict and a reply draft appear at the top of the Inbox preview. Nothing is replied or resolved for you.">
            <code>claude -p</code> reads up to {insightMax} new mentions / replies and writes a verdict (reply /
            fix first / no action) with its reason, the evidence, and a reply draft (Shift+R puts it in the
            reply box). With a clone of the PR's repository in the workspace folder, it checks the code
            read-only and cites file:line. The comment thread is sent to the model.
          </Help>
        </div>

        <div className="grid gap-2">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              checked={autoAgent}
              onChange={(event) => setAutoAgent(event.target.checked)}
              className="h-4 w-4"
            />
            Review pull requests and investigate work items automatically
          </label>
          {autoAgent && !workspace.trim() && (
            <span role="alert" className="text-xs text-amber-700 dark:text-amber-400">
              The workspace folder is empty: reviews see only the diff, and work item investigations cannot read any code.
              Set it so DevDeck can shallow-clone each pull request's repository there.
            </span>
          )}
          <label className="grid gap-1">
            <span className="text-sm font-medium">Items per check</span>
            <input
              type="number"
              min={AUTO_AGENT_MAX_PER_SYNC_MIN}
              max={AUTO_AGENT_MAX_PER_SYNC_MAX}
              value={autoAgentMax}
              onChange={(event) => setAutoAgentMax(Number(event.target.value) || DEFAULT_AUTO_AGENT_MAX_PER_SYNC)}
              className={`${INPUT_CLASS} w-24`}
            />
          </label>
          <label className="grid gap-1">
            <span className="text-sm font-medium">Check every (minutes)</span>
            <input
              type="number"
              min={1}
              max={1440}
              value={autoAgentInterval}
              onChange={(event) => setAutoAgentInterval(Number(event.target.value) || 15)}
              className={`${INPUT_CLASS} w-24`}
            />
          </label>
          <Help summary={<>Every {autoAgentInterval} minutes, up to {autoAgentMax} run one at a time. Needs a result folder for each type; code is not changed and comments are not proposed.</>}>
            The check runs on the next sync after the interval. First reviews cover the full PR, skipping
            drafts, voted PRs and PRs over 30 days old. Tracked PRs continue reviewing later pushes, except
            while in draft, using only changes since the last fully completed review, including force pushes.
            Failed runs retry after a delay; partial coverage keeps the previous reviewed commit. Open human
            requests pause automatic work. Assigned work items (New or Active, changed within 30 days) are
            investigated if they have no prior result. Fields, comments and code changes are sent to the
            default agent.
          </Help>
        </div>

        <div className="grid gap-2">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              checked={autoPipelines}
              onChange={(event) => setAutoPipelines(event.target.checked)}
              className="h-4 w-4"
            />
            Investigate failed watched pipelines automatically
          </label>
          <Help summary="When the latest run of a pipeline you watch fails, the default agent investigates it in the Agent panel.">
            It reports why the run failed, and whether a retry is enough (flaky tests), the code needs a fix,
            or the environment broke. Each run is investigated once, at most 5 per hour. The run's timeline,
            the tail of its failed logs and its failed tests are sent to the agent. Not started in read-only
            validation mode.
          </Help>
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
        {mutation.isSuccess ? (
          <p className="text-sm text-success">Agent command saved.</p>
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
    </SettingsRow>
  );
}
