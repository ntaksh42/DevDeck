// Browser demo of the Home Bot: fixed suggestions and a scripted Orchestrator
// that starts one worker per message and summarizes it a few seconds later.
import type {
  HomeBotSettings,
  HomeBotView,
  HomeChatMessage,
  HomeChatView,
  HomeSuggestion,
  HomeWorker,
  SendHomeMessageInput,
} from "@/lib/commands/homeBot";

const now = () => new Date().toISOString();
const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

function suggestion(id: string, title: string, why: string, ask: string, label: string, kind: string, isNew: boolean): HomeSuggestion {
  const target = kind === "pr" ? `pr:demo/web/${label.slice(1)}` : kind === "wi" ? `wi:demo/${label.slice(1)}` : null;
  return { id, title, why, ask, target, targetLabel: label, webUrl: null, kind, isNew, createdAt: ago(60) };
}

let settings: HomeBotSettings = {
  enabled: true,
  every: "twice-daily",
  weekdaysOnly: true,
  focus: "",
  agent: "claude",
  model: "sonnet",
};
let looking = false;
let lastLookedAt = ago(55);
let seenAt = 0;
let dismissed = 0;
let suggestions: HomeSuggestion[] = [
  suggestion("s1", "!798 の CI を直す", "main 取り込み後 3 回失敗", "!798 の api-tests 失敗の原因を調べて。main の取り込みで入った変更との関係と、直す場所を file:line で示して。", "!798", "pr", true),
  suggestion("s2", "!812 をレビュー", "依頼から 3 日・他は承認済み", "!812 の差分の要点と、レビューで見るべき箇所をまとめて。", "!812", "pr", true),
  suggestion("s3", "#4521 の質問に返信", "メンションから 2 日未返信", "#4521 のコメントを読んで、再現手順で足りない情報を挙げて。", "#4521", "wi", true),
  suggestion("s4", "!790 の衝突を解消", "衝突 1 日・レビュアー 2 名待ち", "!790 のコンフリクトの箇所と、どちらの変更を残すべきかを調べて。", "!790", "pr", false),
];
const brief = [
  "!798 の CI 失敗が最優先",
  "!812 のレビューが 3 日待ち",
];

let chatId = "chat-demo";
let messageId = 3;
let thinking = false;
let messages: HomeChatMessage[] = [
  { id: 1, author: "orchestrator", body: "提案 4 件。急ぐのは **!798 の CI 失敗**。", workerIds: [], createdAt: ago(300) },
];
let workers: HomeWorker[] = [];

export function demoGetHomeBot(): HomeBotView {
  return {
    settings,
    look: {
      running: looking,
      lastLookedAt,
      tookMs: 48_000,
      nextAt: settings.enabled ? new Date(Date.now() + 3 * 3_600_000).toISOString() : null,
      error: null,
      failuresInARow: 0,
    },
    brief,
    suggestions: suggestions.map((s) => ({ ...s, isNew: s.isNew && Date.parse(s.createdAt) > seenAt })),
    newCount: suggestions.filter((s) => s.isNew && Date.parse(s.createdAt) > seenAt).length,
  };
}

export function demoRunHomeLookNow(): null {
  if (looking) throw new Error("Already looking around.");
  looking = true;
  setTimeout(() => {
    looking = false;
    lastLookedAt = now();
  }, 2500);
  return null;
}

export function demoMarkHomeSeen(): null {
  seenAt = Date.now();
  return null;
}

export function demoDismissHomeSuggestion(id: string): null {
  suggestions = suggestions.filter((s) => s.id !== id);
  dismissed += 1;
  return null;
}

export function demoStartHomeSuggestion(id: string) {
  const found = suggestions.find((s) => s.id === id);
  if (!found) throw new Error("That suggestion is no longer listed.");
  return { ask: found.ask, target: found.target, targetLabel: found.targetLabel };
}

export function demoSaveHomeBotSettings(input: HomeBotSettings): HomeBotSettings {
  settings = { ...input, focus: input.focus.trim().slice(0, 500), model: input.model.trim() };
  return settings;
}

export function demoClearHomeDismissed(): null {
  dismissed = 0;
  return null;
}

export const demoCountHomeDismissed = () => dismissed;

export function demoGetHomeChat(): HomeChatView {
  const waitingOn = workers.filter((w) => w.status === "running" || w.status === "queued").length;
  return {
    chatId,
    messages,
    workers,
    state: thinking ? "thinking" : waitingOn > 0 ? "waiting" : "idle",
    waitingOn,
    error: null,
  };
}

function push(author: string, body: string, workerIds: string[] = []) {
  messages = [...messages, { id: messageId++, author, body, workerIds, createdAt: now() }];
}

export function demoSendHomeMessage(input: SendHomeMessageInput): null {
  if (thinking) throw new Error("The Orchestrator is still replying.");
  push("user", input.text);
  if (input.suggestionId) suggestions = suggestions.filter((s) => s.id !== input.suggestionId);
  thinking = true;
  const agent = input.agent ?? settings.agent;
  const label = input.text.match(/[!#]\d+/)?.[0] ?? null;
  setTimeout(() => {
    thinking = false;
    if (!label) {
      push("orchestrator", `(${agent}) 1. !798 の CI 失敗 2. #4521 に返信`);
      return;
    }
    const worker: HomeWorker = {
      id: `d-${Date.now()}`,
      targetLabel: label,
      title: input.text.split("\n")[0].slice(0, 120),
      agent,
      model: input.model || null,
      status: "running",
      askId: Date.now(),
      noteTarget: "ask",
      subject: null,
      createdAt: now(),
      startedAt: now(),
      endedAt: null,
    };
    workers = [worker, ...workers];
    push("orchestrator", `${label} を ${agent} の worker に依頼。`, [worker.id]);
    setTimeout(() => {
      if (!workers.some((w) => w.id === worker.id && w.status === "running")) return;
      workers = workers.map((w) => (w.id === worker.id ? { ...w, status: "done", endedAt: now() } : w));
      push(
        "orchestrator",
        [
          `- **${label}:** \`a1b2c3d\` で戻り値が null 許容に。直す場所は \`src/Orders/OrderServiceTests.cs:84\``,
          "- 影響: `OrderService.Find` の呼び出し 3 か所",
          "- 再現: `dotnet test --filter Orders` で 2 件失敗",
          "- 案: null を空の注文に置き換える (`OrderService.cs:41`)",
          "- 未確認: 夜間ビルドでの再現",
        ].join("\n"),
      );
    }, 5000);
  }, 1200);
  return null;
}

export function demoNewHomeChat(): string {
  chatId = `chat-demo-${Date.now()}`;
  messages = [];
  workers = [];
  return chatId;
}

export function demoStopHomeWorker(id: string): null {
  workers = workers.map((w) => (w.id === id ? { ...w, status: "stopped", endedAt: now() } : w));
  return null;
}

/** Demo dispatch for the Home commands; undefined for anything else. */
export function dispatchHomeBot(command: string, args: unknown): unknown {
  const input = (args as { input?: Record<string, unknown> } | undefined)?.input ?? {};
  switch (command) {
    case "get_home_bot":
      return demoGetHomeBot();
    case "run_home_look_now":
      return demoRunHomeLookNow();
    case "mark_home_seen":
      return demoMarkHomeSeen();
    case "dismiss_home_suggestion":
      return demoDismissHomeSuggestion(String(input.id));
    case "start_home_suggestion":
      return demoStartHomeSuggestion(String(input.id));
    case "save_home_bot_settings":
      return demoSaveHomeBotSettings(input as unknown as HomeBotSettings);
    case "save_home_pipelines":
      return null;
    case "clear_home_dismissed":
      return demoClearHomeDismissed();
    case "count_home_dismissed":
      return demoCountHomeDismissed();
    case "get_home_chat":
      return demoGetHomeChat();
    case "send_home_message":
      return demoSendHomeMessage(input as unknown as SendHomeMessageInput);
    case "new_home_chat":
      return demoNewHomeChat();
    case "stop_home_worker":
      return demoStopHomeWorker(String(input.id));
    default:
      return undefined;
  }
}
