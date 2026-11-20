import { afterEach, describe, expect, it, vi } from "vitest";
import { dispatchHomeBot } from "./homeBot";
import type { HomeBotView, HomeChatView } from "@/lib/commands/homeBot";

const chat = () => dispatchHomeBot("get_home_chat", {}) as HomeChatView;
const bot = () => dispatchHomeBot("get_home_bot", {}) as HomeBotView;

describe("Home Bot demo", () => {
  afterEach(() => vi.useRealTimers());

  it("starts a worker on the chosen agent and summarizes it", () => {
    vi.useFakeTimers();
    dispatchHomeBot("send_home_message", { input: { text: "!798 を調べて", agent: "codex", model: "" } });
    expect(chat().state).toBe("thinking");
    vi.advanceTimersByTime(1300);
    const started = chat();
    expect(started.state).toBe("waiting");
    expect(started.workers[0]).toMatchObject({ agent: "codex", status: "running", targetLabel: "!798" });
    vi.advanceTimersByTime(5100);
    const done = chat();
    expect(done.workers[0].status).toBe("done");
    expect(done.messages[done.messages.length - 1]?.body).toContain("!798 の結果");
  });

  it("dismisses and starts suggestions, and keeps the settings", () => {
    const first = bot().suggestions[0];
    const ask = dispatchHomeBot("start_home_suggestion", { input: { id: first.id } }) as { ask: string };
    expect(ask.ask).toBe(first.ask);
    dispatchHomeBot("dismiss_home_suggestion", { input: { id: first.id } });
    expect(bot().suggestions.some((s) => s.id === first.id)).toBe(false);
    expect(dispatchHomeBot("count_home_dismissed", {})).toBe(1);
    dispatchHomeBot("save_home_bot_settings", {
      input: { ...bot().settings, agent: "codex", model: " ", focus: "x".repeat(600) },
    });
    expect(bot().settings).toMatchObject({ agent: "codex", model: "" });
    expect(bot().settings.focus).toHaveLength(500);
    expect(dispatchHomeBot("unknown_command", {})).toBeUndefined();
  });
});
