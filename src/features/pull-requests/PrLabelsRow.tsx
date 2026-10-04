import { type KeyboardEvent as ReactKeyboardEvent, useEffect, useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import type { PrLabel } from "@/lib/azdoCommands";

const CHIP_BUTTON =
  "inline-flex items-center gap-0.5 rounded border border-border bg-card px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-secondary hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50";

// The pull request's labels as chips, with an inline "Label" box to add one
// (Enter adds, Esc cancels and hands focus back to the button) and an X on each
// chip to remove it.
export function PrLabelsRow({
  labels,
  busy,
  onAdd,
  onRemove,
}: {
  labels: PrLabel[];
  busy: boolean;
  onAdd: (name: string) => void;
  onRemove: (label: PrLabel) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const addButtonRef = useRef<HTMLButtonElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (adding) inputRef.current?.focus();
  }, [adding]);

  function finish() {
    setAdding(false);
    setDraft("");
    window.setTimeout(() => addButtonRef.current?.focus(), 0);
  }

  function onKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      finish();
    } else if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      const name = draft.trim();
      if (name && !labels.some((label) => label.name.toLowerCase() === name.toLowerCase())) {
        onAdd(name);
      }
      finish();
    }
  }

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1">
      <span className="mr-0.5 text-xs text-muted-foreground">Labels</span>
      {labels.map((label) => (
        <span
          key={label.id}
          className="inline-flex items-center gap-0.5 rounded-full border border-border bg-muted px-1.5 py-0.5 text-[11px] text-foreground"
        >
          {label.name}
          <button
            type="button"
            disabled={busy}
            onClick={() => onRemove(label)}
            aria-label={`Remove label ${label.name}`}
            title="Remove label"
            className="rounded p-0.5 text-muted-foreground hover:bg-background hover:text-destructive disabled:opacity-50"
          >
            <X className="h-3 w-3" aria-hidden="true" />
          </button>
        </span>
      ))}
      {adding ? (
        <input
          ref={inputRef}
          type="text"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => {
            setAdding(false);
            setDraft("");
          }}
          aria-label="New label name"
          placeholder="Label, Enter to add"
          className="w-36 rounded border border-input bg-background px-1.5 py-0.5 text-[11px] focus:outline-none focus:ring-2 focus:ring-ring"
        />
      ) : (
        <button
          ref={addButtonRef}
          type="button"
          disabled={busy}
          onClick={() => setAdding(true)}
          title="Add a label"
          className={CHIP_BUTTON}
        >
          <Plus className="h-3 w-3" aria-hidden="true" /> Label
        </button>
      )}
    </div>
  );
}
