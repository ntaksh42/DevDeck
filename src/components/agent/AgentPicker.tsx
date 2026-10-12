import { useRef, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type { AgentKind } from "@/lib/azdoCommands";

const AGENTS: { kind: AgentKind; label: string }[] = [
  { kind: "claude", label: "Claude" },
  { kind: "codex", label: "Codex" },
];

/**
 * Which agent and model the next request goes to, right above the input. The
 * agents are one tab stop (Shift+Tab from the input): Left / Right switch.
 * The model list is the next stop: Up / Down pick. Esc goes back to the input.
 * Both start on Settings and return to it after each send.
 */
export function AgentPicker({
  value,
  defaultAgent,
  onChange,
  model,
  models,
  onModelChange,
  onEscape,
}: {
  value: AgentKind;
  defaultAgent: AgentKind;
  onChange: (next: AgentKind) => void;
  /** "" leaves the model to the agent's own setting. */
  model: string;
  models: string[];
  onModelChange: (next: string) => void;
  onEscape: () => void;
}) {
  const refs = useRef(new Map<AgentKind, HTMLButtonElement>());

  function onAgentKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    event.stopPropagation();
    const index = AGENTS.findIndex((a) => a.kind === value);
    const next = AGENTS[(index + (event.key === "ArrowRight" ? 1 : AGENTS.length - 1)) % AGENTS.length].kind;
    onChange(next);
    refs.current.get(next)?.focus();
  }

  return (
    <div
      className="mb-1 flex items-center gap-1 text-[11px]"
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        onEscape();
      }}
    >
      <span className="text-muted-foreground">To</span>
      <div role="radiogroup" aria-label="Agent" className="flex items-center gap-1" onKeyDown={onAgentKeyDown}>
        {AGENTS.map(({ kind, label }) => (
          <button
            key={kind}
            ref={(el) => {
              if (el) refs.current.set(kind, el);
              else refs.current.delete(kind);
            }}
            type="button"
            role="radio"
            aria-checked={value === kind}
            tabIndex={value === kind ? 0 : -1}
            onClick={() => onChange(kind)}
            title={`${label}${kind === defaultAgent ? " (default, Settings)" : ""} · ←→ to switch`}
            className={`rounded-full border px-1.5 py-px focus:outline-none focus:ring-1 focus:ring-ring ${
              value === kind
                ? "border-primary bg-primary/10 font-medium text-primary"
                : "border-border text-muted-foreground hover:bg-accent"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <select
        aria-label="Model"
        value={model}
        onChange={(event) => onModelChange(event.target.value)}
        title="Model · ↑↓ to pick (Settings sets the default and the list)"
        className="ml-1 h-5 min-w-0 max-w-[10rem] rounded border border-border bg-background px-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-ring"
      >
        <option value="">CLI default</option>
        {models.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>
    </div>
  );
}
