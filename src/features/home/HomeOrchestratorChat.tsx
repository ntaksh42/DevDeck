import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ArrowDown, Bot, Info } from "lucide-react";
import { NoteMarkdown } from "@/components/agent-notes/NoteMarkdown";
import type { HomeChatMessage, HomeChatView, HomeWorker } from "@/lib/azdoCommands";
import { WorkerStatusPill, workerDetail } from "./HomeWorkersPanel";

export type HomeDraft = {
  key: number;
  text: string;
  target: string | null;
  targetLabel: string | null;
  suggestionId: string | null;
};

export const EMPTY_DRAFT: HomeDraft = { key: 0, text: "", target: null, targetLabel: null, suggestionId: null };

/** Starters shown on an empty chat when there is no brief; one click puts it in the input. */
const STARTERS = ["今日の優先は？", "自分待ちのものは？", "止まっている自分の PR は？"];

/** Starters from the latest brief (one per line, up to three), else the fixed ones. */
export function chatStarters(brief: string[]): string[] {
  const fromBrief = brief
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 3)
    .map((line) => `${line.replace(/[。.]$/, "")} について詳しく`);
  return fromBrief.length ? fromBrief : STARTERS;
}

/** Orchestrator replies taller than this (four lines of text) fold behind "Show more". */
const FOLD_PX = 96;

/** An Orchestrator reply that folds when it runs past four lines. */
function FoldingBody({ text }: { text: string }) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const [long, setLong] = useState(false);
  const [open, setOpen] = useState(false);
  useLayoutEffect(() => {
    const element = bodyRef.current;
    if (element) setLong(element.scrollHeight > FOLD_PX + 8);
  }, [text]);
  const folded = long && !open;
  return (
    <>
      <div
        ref={bodyRef}
        className={folded ? "overflow-hidden [mask-image:linear-gradient(to_bottom,black_60%,transparent)]" : ""}
        style={folded ? { maxHeight: FOLD_PX } : undefined}
      >
        <NoteMarkdown text={text} className="text-sm leading-6 text-foreground" />
      </div>
      {long ? (
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
          className="mt-0.5 text-xs text-link hover:underline focus-visible:underline focus-visible:outline-none"
        >
          {open ? "Show less" : "Show more"}
        </button>
      ) : null}
    </>
  );
}

function stateLabel(state: HomeChatView["state"], waitingOn: number): string {
  if (state === "thinking") return "Replying…";
  if (state === "waiting") return `${waitingOn} worker${waitingOn === 1 ? "" : "s"} running`;
  return "Idle";
}

/** The Orchestrator's state, shown in the chat panel's tab strip. */
export function OrchestratorStatePill({ state, waitingOn }: { state: HomeChatView["state"]; waitingOn: number }) {
  const busy = state !== "idle";
  return (
    <span aria-live="polite" className={`inline-flex items-center gap-1 whitespace-nowrap text-xs ${busy ? "text-info" : "text-muted-foreground"}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${busy ? "animate-pulse bg-info" : "bg-success"}`} aria-hidden="true" />
      {stateLabel(state, waitingOn)}
    </span>
  );
}

function time(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function dayLabel(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86_400_000);
  if (date.toDateString() === today.toDateString()) return "Today";
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return date.toLocaleDateString([], { month: "short", day: "numeric", weekday: "short" });
}

function Avatar() {
  return (
    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-violet-600 text-white dark:bg-violet-500" aria-hidden="true">
      <Bot className="h-4 w-4" />
    </span>
  );
}

function WorkerCard({ worker, onOpen }: { worker: HomeWorker; onOpen: (worker: HomeWorker) => void }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(worker)}
      title="Open the worker's conversation in the Agent panel"
      className="flex w-full min-w-0 items-center gap-2 overflow-hidden rounded-lg border border-border bg-card px-2.5 py-1.5 text-left text-xs shadow-sm transition-colors hover:border-primary/40 hover:bg-secondary"
    >
      <WorkerStatusPill status={worker.status} />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium text-foreground">
          <span className="text-link">{worker.targetLabel}</span> {worker.title}
        </span>
        <span className="block truncate text-muted-foreground">{workerDetail(worker)}</span>
      </span>
    </button>
  );
}

function Message({
  message,
  first,
  workers,
  onOpenWorker,
}: {
  message: HomeChatMessage;
  /** First of a run by the same author: shows the avatar and name. */
  first: boolean;
  workers: Map<string, HomeWorker>;
  onOpenWorker: (worker: HomeWorker) => void;
}) {
  if (message.author === "system") {
    return (
      <div className="flex justify-center">
        <p className="inline-flex max-w-[90%] items-start gap-1.5 rounded-full bg-warning/10 px-3 py-1 text-xs text-warning">
          <Info className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {message.body}
        </p>
      </div>
    );
  }
  if (message.author === "user") {
    return (
      <div className="group flex flex-col items-end">
        <div className="max-w-[80%] rounded-2xl rounded-br-md bg-primary px-3.5 py-2 text-primary-foreground shadow-sm">
          <NoteMarkdown text={message.body} className="text-sm leading-6 [&_a]:text-primary-foreground [&_a]:underline [&_code]:bg-white/20" />
        </div>
        <span className="mt-0.5 text-xs text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">{time(message.createdAt)}</span>
      </div>
    );
  }
  const cards = message.workerIds.map((id) => workers.get(id)).filter((w): w is HomeWorker => !!w);
  return (
    <div className="group flex gap-2.5">
      <div className="w-7 shrink-0">{first ? <Avatar /> : null}</div>
      <div className="min-w-0 flex-1">
        {first ? (
          <div className="mb-0.5 flex items-baseline gap-2">
            <span className="text-sm font-semibold text-foreground">Orchestrator</span>
            <span className="text-xs text-muted-foreground">{time(message.createdAt)}</span>
          </div>
        ) : null}
        <div className="max-w-[92%] rounded-2xl rounded-tl-md bg-muted px-3.5 py-2">
          <FoldingBody text={message.body} />
        </div>
        {cards.length ? (
          <div className="mt-1.5 grid max-w-[92%] grid-cols-1 gap-1.5">
            {cards.map((worker) => (
              <WorkerCard key={worker.id} worker={worker} onOpen={onOpenWorker} />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Typing() {
  return (
    <div className="flex gap-2.5" role="status" aria-label="Orchestrator is replying">
      <Avatar />
      <div className="flex items-center gap-1 rounded-2xl rounded-tl-md bg-muted px-3.5 py-3">
        {[0, 150, 300].map((delay) => (
          <span
            key={delay}
            className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground"
            style={{ animationDelay: `${delay}ms` }}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * The always-on Orchestrator chat, laid out like a chat app: day separators,
 * the user's messages as right-aligned bubbles, the Orchestrator's on the
 * left with its avatar once per run, the workers it started as cards, a
 * typing indicator while it replies, and the input pinned to the bottom.
 */
export function HomeOrchestratorChat({
  chat,
  brief,
  composer,
  onStarter,
  onOpenWorker,
}: {
  chat: HomeChatView | undefined;
  /** The latest Look around brief: the empty chat offers its lines as starters. */
  brief: string[];
  composer: ReactNode;
  onStarter: (text: string) => void;
  onOpenWorker: (worker: HomeWorker) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const [showJump, setShowJump] = useState(false);
  const messages = chat?.messages ?? [];
  const workers = new Map((chat?.workers ?? []).map((worker) => [worker.id, worker]));
  const thinking = chat?.state === "thinking";

  const toBottom = () => {
    const element = scrollRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  };

  // Follow new messages while the user is at the bottom; otherwise offer a jump.
  useEffect(() => {
    if (stickRef.current) toBottom();
    else setShowJump(true);
  }, [messages.length, thinking]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-card" data-home-chat="true">
      <div className="relative min-h-0 flex-1">
        <div
          ref={scrollRef}
          role="log"
          aria-label="Orchestrator chat"
          onScroll={(event) => {
            const el = event.currentTarget;
            stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
            if (stickRef.current) setShowJump(false);
          }}
          className="h-full space-y-3 overflow-auto px-4 py-4"
        >
          {messages.length === 0 && !thinking ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-violet-600 text-white dark:bg-violet-500">
                <Bot className="h-6 w-6" aria-hidden="true" />
              </span>
              <p className="text-sm font-semibold">Orchestrator</p>
              <div className="flex flex-wrap justify-center gap-2">
                {chatStarters(brief).map((starter) => (
                  <button
                    key={starter}
                    type="button"
                    onClick={() => onStarter(starter)}
                    className="rounded-full border border-border px-3 py-1 text-xs hover:border-primary/40 hover:bg-secondary"
                  >
                    {starter}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {messages.map((message, index) => {
            const previous = messages[index - 1];
            const newDay = !previous || dayLabel(previous.createdAt) !== dayLabel(message.createdAt);
            const first = newDay || previous.author !== message.author;
            return (
              <Fragment key={message.id}>
                {newDay ? (
                  <div className="flex items-center gap-3 py-1 text-xs text-muted-foreground" role="separator">
                    <span className="h-px flex-1 bg-border" />
                    {dayLabel(message.createdAt)}
                    <span className="h-px flex-1 bg-border" />
                  </div>
                ) : null}
                <Message message={message} first={first} workers={workers} onOpenWorker={onOpenWorker} />
              </Fragment>
            );
          })}
          {thinking ? <Typing /> : null}
          {chat?.error ? (
            <div className="flex justify-center">
              <p role="alert" className="rounded-full bg-destructive/10 px-3 py-1 text-xs text-destructive">
                Reply failed: {chat.error}
              </p>
            </div>
          ) : null}
        </div>
        {showJump ? (
          <button
            type="button"
            onClick={() => {
              stickRef.current = true;
              setShowJump(false);
              toBottom();
            }}
            className="absolute bottom-2 left-1/2 inline-flex -translate-x-1/2 items-center gap-1 rounded-full border border-border bg-card px-3 py-1 text-xs shadow-md hover:bg-secondary"
          >
            <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
            New messages
          </button>
        ) : null}
      </div>
      {composer}
    </div>
  );
}
