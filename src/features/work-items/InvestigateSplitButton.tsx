import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Bot, ChevronDown, Loader2 } from "lucide-react";
import type { AgentKind } from "@/lib/azdoCommands";

/** The agent for one investigation run; "" leaves it to the default agent in Settings. */
export type InvestigateAgentChoice = AgentKind | "";

const CHOICES: { value: InvestigateAgentChoice; label: string }[] = [
  { value: "", label: "Default agent (Settings)" },
  { value: "claude", label: "Claude" },
  { value: "codex", label: "Codex" },
];

/**
 * "Investigate" with the agent picked from the arrow next to it. The arrow is
 * its own tab stop: Enter / Down opens the menu on the current choice, Up / Down
 * move, Enter picks, Escape closes; focus returns to the arrow either way. A
 * non-default choice is shown on the button.
 */
export function InvestigateSplitButton({
  agent,
  onAgentChange,
  onRun,
  pending,
  title,
}: {
  agent: InvestigateAgentChoice;
  onAgentChange: (next: InvestigateAgentChoice) => void;
  onRun: () => void;
  pending: boolean;
  title: string;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const chosen = CHOICES.find((choice) => choice.value === agent);

  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
    const onDown = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  function close() {
    setOpen(false);
    toggleRef.current?.focus();
  }

  function onMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? []);
    const index = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === "ArrowDown") items[(index + 1) % items.length]?.focus();
    else if (event.key === "ArrowUp") items[(index - 1 + items.length) % items.length]?.focus();
    else if (event.key === "Escape") close();
    else if (event.key !== "Enter" && event.key !== " ") return;
    if (event.key !== "Enter" && event.key !== " ") event.preventDefault();
    event.stopPropagation();
  }

  const buttonClass =
    "inline-flex h-7 items-center gap-1 border border-border bg-card px-2.5 text-xs font-medium hover:bg-secondary disabled:opacity-60";
  return (
    <div ref={wrapRef} className="relative inline-flex">
      <button type="button" disabled={pending} onClick={onRun} title={title} className={`${buttonClass} rounded-l-md`}>
        {pending ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> : <Bot className="h-3 w-3" aria-hidden="true" />}
        Investigate{agent ? <b className="font-semibold"> ({chosen?.label})</b> : null}
      </button>
      <button
        ref={toggleRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Choose the agent for the investigation"
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" && !open) {
            event.preventDefault();
            event.stopPropagation();
            setOpen(true);
          }
        }}
        className={`${buttonClass} -ml-px rounded-r-md px-1.5`}
      >
        <ChevronDown className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
      </button>
      {open ? (
        <div
          ref={menuRef}
          role="menu"
          aria-label="Agent"
          onKeyDown={onMenuKeyDown}
          className="absolute left-0 top-full z-30 mt-1 min-w-[190px] rounded-md border border-border bg-popover py-1 shadow-lg"
        >
          {CHOICES.map((choice) => (
            <button
              key={choice.value}
              type="button"
              role="menuitemradio"
              aria-checked={choice.value === agent}
              tabIndex={choice.value === agent ? 0 : -1}
              onClick={() => {
                onAgentChange(choice.value);
                close();
              }}
              className={`flex w-full items-center px-3 py-1.5 text-left text-xs hover:bg-muted ${choice.value === agent ? "font-semibold text-foreground" : "text-muted-foreground"}`}
            >
              {choice.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
