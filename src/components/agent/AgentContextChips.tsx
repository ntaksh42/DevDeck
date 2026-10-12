import { useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Pin, X } from "lucide-react";
import type { AgentListScope } from "./agentListScope";
import { subjectLabel, type AgentSubject } from "./agentSubject";

type Chip = {
  key: "subject" | "list";
  label: string;
  attached: boolean;
  /** Attached or not, flip it. */
  toggle: () => void;
  /** Only the subject can be pinned. */
  pinnable: boolean;
};

const CHIP = "flex min-w-0 max-w-[16rem] items-center gap-1 rounded-full border px-1.5 py-px";
const SMALL_BUTTON = "shrink-0 rounded hover:bg-accent focus:outline-none focus:ring-1 focus:ring-ring";

/**
 * What the next request carries, right above the input. An attached context is a
 * solid chip (the subject can be pinned, either can be removed); one the view could
 * offer is a dashed "+" chip. The chips are one roving tab stop: Shift+Tab from the
 * input reaches them, Left / Right move, Space / Enter attach or detach, P pins the
 * subject, Esc goes back to the input.
 */
export function AgentContextChips({
  subject,
  offered,
  pinned,
  list,
  listAttached,
  onTogglePin,
  onSubjectChange,
  onListAttachedChange,
  onEscape,
}: {
  /** The subject the next request carries (the selection, or the pinned one). */
  subject: AgentSubject | null;
  /** The view's selection when it is not attached (removed), so it can be added back. */
  offered: AgentSubject | null;
  pinned: boolean;
  list: AgentListScope | null;
  listAttached: boolean;
  onTogglePin: () => void;
  /** `true`: follow the selection again; `false`: ask without a subject. */
  onSubjectChange: (attach: boolean) => void;
  onListAttachedChange: (attach: boolean) => void;
  onEscape: () => void;
}) {
  const chips: Chip[] = [];
  const shownSubject = subject ?? offered;
  if (shownSubject) {
    chips.push({
      key: "subject",
      label: subjectLabel(shownSubject),
      attached: !!subject,
      toggle: () => onSubjectChange(!subject),
      pinnable: true,
    });
  }
  if (list) {
    chips.push({
      key: "list",
      label: `${list.label} (${list.count})`,
      attached: listAttached,
      toggle: () => onListAttachedChange(!listAttached),
      pinnable: false,
    });
  }

  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const tabStop = chips.find((chip) => chip.key === activeKey)?.key ?? chips[0]?.key;

  function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void {
    const index = chips.findIndex((chip) => buttons.current.get(chip.key) === event.target);
    if (index < 0) return;
    const chip = chips[index];
    const lower = event.key.toLowerCase();
    const plain = !event.ctrlKey && !event.metaKey && !event.altKey;
    const handled = () => {
      event.preventDefault();
      event.stopPropagation();
    };
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      handled();
      const next = chips[Math.max(0, Math.min(chips.length - 1, index + (event.key === "ArrowRight" ? 1 : -1)))];
      setActiveKey(next.key);
      buttons.current.get(next.key)?.focus();
    } else if (event.key === "Enter" || event.key === " ") {
      // Handled here, not by the click the key would synthesize, so it works the same everywhere.
      handled();
      chip.toggle();
    } else if (plain && lower === "p" && chip.pinnable && chip.attached) {
      handled();
      onTogglePin();
    } else if (event.key === "Escape") {
      handled();
      onEscape();
    }
  }

  return (
    <div
      role="toolbar"
      aria-label="Agent context"
      className="mb-1 flex flex-wrap items-center gap-1 text-[11px]"
      onKeyDown={onKeyDown}
      // Space activates a button on key-up; the key-down already did.
      onKeyUp={(event) => {
        if (event.key === " " && [...buttons.current.values()].includes(event.target as HTMLButtonElement)) {
          event.preventDefault();
        }
      }}
    >
      <span className="shrink-0 text-muted-foreground">Context</span>
      {chips.map((chip) => (
        <span
          key={chip.key}
          className={`${CHIP} ${
            chip.attached
              ? "border-primary/50 bg-primary/10 text-foreground"
              : "border-dashed border-border text-muted-foreground hover:text-foreground"
          }`}
        >
          <button
            type="button"
            ref={(el) => {
              if (el) buttons.current.set(chip.key, el);
              else buttons.current.delete(chip.key);
            }}
            tabIndex={chip.key === tabStop ? 0 : -1}
            aria-pressed={chip.attached}
            aria-label={`${chip.attached ? "Attached" : "Attach"}: ${chip.label}`}
            title={`${chip.label} — Space: ${chip.attached ? "remove" : "attach"}${chip.pinnable && chip.attached ? ", P: pin" : ""}, Esc: back to the input`}
            onFocus={() => setActiveKey(chip.key)}
            onClick={chip.toggle}
            className="min-w-0 truncate rounded focus:outline-none focus:ring-1 focus:ring-ring"
          >
            {chip.attached ? chip.label : `+ ${chip.label}`}
          </button>
          {chip.attached && chip.pinnable ? (
            <button
              type="button"
              tabIndex={-1}
              aria-pressed={pinned}
              aria-label={pinned ? "Unpin the subject" : "Pin the subject"}
              title={pinned ? "Follow the selection again (P)" : "Keep this subject when the selection moves (P)"}
              onClick={onTogglePin}
              className={`${SMALL_BUTTON} ${pinned ? "text-primary" : "text-muted-foreground"}`}
            >
              <Pin className="h-3 w-3" aria-hidden="true" />
            </button>
          ) : null}
          {chip.attached ? (
            <button
              type="button"
              tabIndex={-1}
              onClick={chip.toggle}
              aria-label={chip.key === "subject" ? "Remove the subject" : "Remove the list"}
              title={chip.key === "subject" ? "Ask without a subject" : "Leave the list out"}
              className={SMALL_BUTTON}
            >
              <X className="h-3 w-3" aria-hidden="true" />
            </button>
          ) : null}
        </span>
      ))}
      {chips.length === 0 ? <span className="text-muted-foreground">nothing in this view</span> : null}
    </div>
  );
}
