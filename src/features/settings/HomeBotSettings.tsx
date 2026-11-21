import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  clearHomeDismissed,
  commandErrorMessage,
  countHomeDismissed,
  getHomeBot,
  homeBotKey,
  HOME_EVERY_CHOICES,
  HOME_EVERY_LABELS,
  saveHomeBotSettings,
  type HomeBotSettings,
} from "@/lib/azdoCommands";
import { SettingsRow } from "./SettingsRow";

const INPUT =
  "h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring disabled:opacity-60";

/** Home: who looks around and answers in the Orchestrator chat, how often, and what to look for. */
export function HomeBotSettingsPanel() {
  const queryClient = useQueryClient();
  const botQuery = useQuery({ queryKey: homeBotKey, queryFn: getHomeBot });
  const dismissedQuery = useQuery({ queryKey: ["homeDismissed"], queryFn: countHomeDismissed });
  const [form, setForm] = useState<HomeBotSettings | null>(null);
  const saved = botQuery.data?.settings;

  useEffect(() => {
    if (saved) setForm(saved);
  }, [saved]);

  const save = useMutation({
    mutationFn: saveHomeBotSettings,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: homeBotKey }),
  });
  const clear = useMutation({
    mutationFn: clearHomeDismissed,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["homeDismissed"] }),
  });

  if (!form) return null;
  const set = (patch: Partial<HomeBotSettings>) => setForm((current) => (current ? { ...current, ...patch } : current));
  const look = botQuery.data?.look;

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (form) save.mutate(form);
  }

  return (
    <SettingsRow
      title="Home Bot"
      description={
        <>
          Look around reads what DevDeck has synced a few times a day (read-only) and lists next steps in Home. The
          Orchestrator chat in Home uses the same agent unless you pick another one above its input.
        </>
      }
    >
      <form className="grid gap-3" onSubmit={onSubmit}>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
          Look around on a schedule
          {look?.lastLookedAt ? <span className="text-xs text-muted-foreground">(last look {new Date(look.lastLookedAt).toLocaleString()})</span> : null}
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <select
            aria-label="How often"
            value={form.every}
            onChange={(e) => set({ every: e.target.value as HomeBotSettings["every"] })}
            className={INPUT}
          >
            {HOME_EVERY_CHOICES.map((every) => (
              <option key={every} value={every}>
                {HOME_EVERY_LABELS[every]}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.weekdaysOnly} onChange={(e) => set({ weekdaysOnly: e.target.checked })} />
            Weekdays only
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <select
            aria-label="Agent"
            value={form.agent}
            onChange={(e) => set({ agent: e.target.value as HomeBotSettings["agent"], model: "" })}
            className={INPUT}
          >
            <option value="claude">Claude Code</option>
            <option value="codex">Codex</option>
          </select>
          <input
            aria-label="Model"
            value={form.model}
            onChange={(e) => set({ model: e.target.value })}
            placeholder={form.agent === "claude" ? "sonnet (empty: the agent's own setting)" : "empty: the agent's own setting"}
            className={`${INPUT} w-72`}
          />
        </div>
        <label className="grid gap-1 text-sm">
          <span className="font-medium">Focus</span>
          <textarea
            value={form.focus}
            maxLength={500}
            rows={3}
            onChange={(e) => set({ focus: e.target.value })}
            placeholder="Empty: reviews asked of you, failing checks and conflicts on your pull requests, questions to you, and agent conversations that need you."
            className="rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={save.isPending}
            className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-60"
          >
            Save
          </button>
          <span className="text-xs text-muted-foreground">Dismissed suggestions: {dismissedQuery.data ?? 0} (each held back 7 days)</span>
          <button
            type="button"
            disabled={!dismissedQuery.data || clear.isPending}
            onClick={() => clear.mutate()}
            className="h-7 rounded border border-border px-2 text-xs hover:bg-secondary disabled:opacity-50"
          >
            Clear
          </button>
        </div>
        {save.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {commandErrorMessage(save.error)}
          </p>
        ) : null}
        {save.isSuccess ? <p className="text-sm text-success">Home Bot settings saved.</p> : null}
      </form>
    </SettingsRow>
  );
}
