import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { DockableWorkspace, type DockablePanelSpec } from "@/components/DockableWorkspace";
import { ListStatusBar, itemCount } from "@/components/ListStatusBar";
import { ErrorState, LoadingState } from "@/components/StateDisplay";
import { modelChoices, settingsModel } from "@/components/agent/agentModels";
import { openAgentPanel } from "@/components/agent/agentSubject";
import { commandErrorMessage, getAppSettings, startHomeSuggestion, type AgentKind, type HomeWorker } from "@/lib/azdoCommands";
import { openExternalUrl } from "@/lib/openExternal";
import { pushNotice, pushToast } from "@/lib/toast";
import { clamp, formatRelativeDate } from "@/lib/utils";
import { shareWithLookAround } from "@/features/pipelines/pipelineSubscriptionsStorage";
import { HomeChatComposer } from "./HomeChatComposer";
import { EMPTY_DRAFT, HomeOrchestratorChat, OrchestratorStatePill, type HomeDraft } from "./HomeOrchestratorChat";
import { HOME_SUGGESTIONS_SHOWN, HomeSuggestionList } from "./HomeSuggestionList";
import { HomeWorkersPanel } from "./HomeWorkersPanel";
import { useHomeBot } from "./useHomeBot";

function shortTime(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" });
}

/**
 * Home: the Look around brief and suggestions on the left, the always-on
 * Orchestrator chat (and the workers it started) on the right.
 */
export function HomeView() {
  const { bot, chat, lookNow, dismiss, send, stop, newChat, seen } = useHomeBot();
  const settingsQuery = useQuery({ queryKey: ["appSettings"], queryFn: getAppSettings });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [errorOpen, setErrorOpen] = useState(false);
  const [draft, setDraft] = useState<HomeDraft>(EMPTY_DRAFT);
  const [choice, setChoice] = useState<{ agent: AgentKind | null; model: string | null }>({ agent: null, model: null });
  const [activate, setActivate] = useState<{ id: string; key: number }>({ id: "chat", key: 1 });
  const listRef = useRef<HTMLDivElement>(null);
  const markSeen = seen.mutate;

  // Opening Home reads the suggestions (and arms the schedule the first time).
  useEffect(() => markSeen(), [markSeen]);
  // Look around reads the watched pipelines from a backend copy; refresh it.
  useEffect(() => shareWithLookAround(), []);

  const focusList = useCallback(() => listRef.current?.focus(), []);
  const attachList = useCallback((element: HTMLDivElement | null) => {
    listRef.current = element;
    element?.focus();
  }, []);

  const view = bot.data;
  const suggestions = view?.suggestions ?? [];
  const selected = suggestions.find((s) => s.id === selectedId) ?? suggestions[0] ?? null;
  const selectedIndex = selected ? suggestions.indexOf(selected) : -1;
  const homeAgent: AgentKind = view?.settings.agent ?? "claude";
  const agent = choice.agent ?? homeAgent;
  const model =
    choice.model ?? (agent === homeAgent ? (view?.settings.model ?? "") : settingsModel(settingsQuery.data, agent));
  const chatData = chat.data;

  const showPanel = (id: string) => setActivate((current) => ({ id, key: current.key + 1 }));

  function focusComposer() {
    showPanel("chat");
    window.requestAnimationFrame(() =>
      document.querySelector<HTMLTextAreaElement>("[data-home-composer='true'] textarea")?.focus(),
    );
  }

  function focusWorkers() {
    showPanel("workers");
    window.requestAnimationFrame(() => document.querySelector<HTMLElement>("[data-home-workers='true']")?.focus());
  }

  function move(index: number) {
    const target = suggestions[clamp(index, 0, suggestions.length - 1)];
    if (!target) return;
    if (suggestions.indexOf(target) >= HOME_SUGGESTIONS_SHOWN) setShowAll(true);
    setSelectedId(target.id);
  }

  async function start() {
    if (!selected) return;
    try {
      const ask = await startHomeSuggestion(selected.id);
      setDraft((current) => ({
        key: current.key + 1,
        text: ask.ask,
        target: ask.target,
        targetLabel: ask.targetLabel,
        suggestionId: selected.id,
      }));
      showPanel("chat");
    } catch (error) {
      pushToast(commandErrorMessage(error));
    }
  }

  function dismissSelected() {
    if (!selected) return;
    const next = suggestions[selectedIndex + 1] ?? suggestions[selectedIndex - 1] ?? null;
    setSelectedId(next?.id ?? null);
    dismiss.mutate(selected.id);
  }

  function openSelectedInBrowser() {
    if (selected?.webUrl) void openExternalUrl(selected.webUrl);
    else if (selected) pushNotice("This suggestion has no link.");
  }

  async function sendMessage(text: string) {
    await send.mutateAsync({ text, target: draft.target, suggestionId: draft.suggestionId, agent, model });
    setDraft((current) => ({ ...EMPTY_DRAFT, key: current.key + 1 }));
    setChoice({ agent: null, model: null });
    focusList();
  }

  /** A PR / WI worker answers in that item's notes; others in their own request. */
  function openWorker(worker: HomeWorker) {
    const subject = worker.subject;
    if (subject?.kind === "pull-request" && subject.repositoryId && subject.repositoryName) {
      openAgentPanel({
        subject: {
          kind: "pull-request",
          id: subject.id,
          title: subject.title,
          organizationId: subject.organizationId,
          projectId: subject.projectId,
          repositoryId: subject.repositoryId,
          repositoryName: subject.repositoryName,
          webUrl: subject.webUrl,
        },
      });
    } else if (subject?.kind === "work-item") {
      openAgentPanel({
        subject: {
          kind: "work-item",
          id: subject.id,
          title: subject.title,
          organizationId: subject.organizationId,
          projectId: subject.projectId,
          webUrl: subject.webUrl,
        },
      });
    } else {
      openAgentPanel({ askId: worker.askId });
    }
  }

  function onListKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.target !== listRef.current || event.metaKey || event.altKey) return;
    const key = event.key.toLowerCase();
    if (event.ctrlKey) {
      if (event.key !== "Enter") return;
      openSelectedInBrowser();
    } else if (event.key === "ArrowDown") move(selectedIndex + 1);
    else if (event.key === "ArrowUp") move(selectedIndex - 1);
    else if (key === "q") void start();
    else if (key === "e") dismissSelected();
    else if (key === "l") lookNow.mutate();
    else if (key === "m" || event.key === "ArrowRight" || event.key === "Enter") focusComposer();
    else if (key === "w") focusWorkers();
    else if (key === "n") newChat.mutate();
    else if (key === "o") openSelectedInBrowser();
    else return;
    event.preventDefault();
    event.stopPropagation();
  }

  if (bot.isLoading) return <LoadingState />;
  if (bot.isError || !view) {
    return <ErrorState message={commandErrorMessage(bot.error)} onRetry={() => void bot.refetch()} />;
  }

  const look = view.look;
  const lookText = look.running
    ? "Looking…"
    : look.lastLookedAt
      ? `Looked ${formatRelativeDate(look.lastLookedAt)}`
      : "Not looked yet";
  const briefMeta = [view.settings.agent === "codex" ? "Codex" : "Claude", view.settings.model].filter(Boolean).join(" ・ ");

  const listPane = (
    <div className="flex h-full min-h-0 flex-col">
      {!look.running && look.error ? (
        <button
          type="button"
          role="alert"
          aria-expanded={errorOpen}
          onClick={() => setErrorOpen((open) => !open)}
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            setErrorOpen(false);
            focusList();
          }}
          title={errorOpen ? "Collapse (Enter)" : "Show the whole error (Enter)"}
          className={`border-b border-destructive/30 bg-destructive/10 px-3 py-1 text-left text-xs text-destructive outline-none focus-visible:ring-1 focus-visible:ring-destructive ${
            errorOpen ? "whitespace-pre-wrap break-words" : "truncate"
          }`}
        >
          Look failed{look.failuresInARow > 1 ? ` ×${look.failuresInARow}` : ""}: {look.error}
        </button>
      ) : null}
      <HomeSuggestionList
        ref={attachList}
        brief={view.brief}
        briefMeta={briefMeta}
        suggestions={suggestions}
        selectedId={selected?.id ?? null}
        showAll={showAll}
        onShowAll={() => setShowAll(true)}
        onSelect={(id) => {
          setSelectedId(id);
          focusList();
        }}
        onKeyDown={onListKeyDown}
      />
      <ListStatusBar
        summary={[
          itemCount(suggestions.length),
          view.newCount ? `${view.newCount} new` : null,
          look.nextAt ? `Next look ${shortTime(look.nextAt)}` : "Look around off",
        ]}
        helpSection="home"
      >
        <span className="text-2xs text-muted-foreground">Q start ・ E dismiss ・ L look</span>
      </ListStatusBar>
    </div>
  );

  const lookButton = (
    <span className="flex items-center gap-2 text-2xs text-muted-foreground">
      <span role="status">{lookText}</span>
      <button
        type="button"
        onClick={() => lookNow.mutate()}
        disabled={look.running}
        aria-keyshortcuts="L"
        title="Look now (L)"
        className="inline-flex items-center gap-1 rounded border border-border bg-card px-1.5 py-px hover:bg-secondary disabled:opacity-60"
      >
        <RefreshCw className={`h-3 w-3 ${look.running ? "animate-spin" : ""}`} aria-hidden="true" />
        Look now
      </button>
    </span>
  );

  const chatActions = (
    <span className="flex items-center gap-2">
      <OrchestratorStatePill state={chatData?.state ?? "idle"} waitingOn={chatData?.waitingOn ?? 0} />
      <button
        type="button"
        onClick={() => newChat.mutate()}
        title="Start a new chat (N on the list)"
        className="rounded border border-border bg-card px-1.5 text-2xs hover:bg-secondary"
      >
        New chat
      </button>
    </span>
  );

  const models = [
    ...new Set([...(agent === homeAgent && view.settings.model ? [view.settings.model] : []), ...modelChoices(settingsQuery.data, agent)]),
  ];
  const composer = (
    <HomeChatComposer
      draft={draft}
      busy={send.isPending || chatData?.state === "thinking"}
      agent={agent}
      defaultAgent={homeAgent}
      onAgentChange={(next) => setChoice({ agent: next, model: null })}
      model={model}
      models={models}
      onModelChange={(next) => setChoice((current) => ({ ...current, model: next }))}
      onClearTarget={() => setDraft((current) => ({ ...current, target: null, targetLabel: null }))}
      onSend={sendMessage}
      onLeave={focusList}
    />
  );

  return (
    <div className="flex h-full min-h-0 flex-1">
      <DockableWorkspace
        storageKey="azdodeck:home:dockview:v1"
        activatePanel={activate}
        panels={[
          { id: "list", title: "Suggestions", headerActions: lookButton, content: listPane, minWidth: 380 },
          {
            id: "chat",
            title: "Orchestrator",
            headerActions: chatActions,
            content: (
              <HomeOrchestratorChat
                chat={chatData}
                brief={view.brief}
                composer={composer}
                onStarter={(text) => setDraft((current) => ({ ...EMPTY_DRAFT, key: current.key + 1, text }))}
                onOpenWorker={openWorker}
              />
            ),
            position: { relativeTo: "list", direction: "right" },
            minWidth: 340,
          },
          {
            id: "workers",
            // Dockview keeps the first title, so the live count sits in the panel's status bar.
            title: "Workers",
            content: (
              <HomeWorkersPanel
                workers={chatData?.workers ?? []}
                onOpen={openWorker}
                onStop={(worker) => stop.mutate(worker.id)}
                onExit={focusList}
              />
            ),
            position: { relativeTo: "chat", direction: "within" },
            minWidth: 340,
          },
        ] satisfies DockablePanelSpec[]}
      />
    </div>
  );
}
