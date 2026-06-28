import { type KeyboardEvent as ReactKeyboardEvent, useState } from 'react';
import { Keyboard } from 'lucide-react';
import {
  KEYBINDINGS,
  comboFromEvent,
  defaultKeybindingMap,
  findConflicts,
  keybindingLabel,
  resolveKeybindings,
  saveKeybindingOverrides,
  type KeybindingId,
  type KeybindingMap,
} from "@/lib/keybindings";

export function KeyboardShortcutSettings() {
  const defaults = defaultKeybindingMap();
  const [savedMap, setSavedMap] = useState<KeybindingMap>(resolveKeybindings);
  const [draft, setDraft] = useState<KeybindingMap>(savedMap);
  const [capturingId, setCapturingId] = useState<KeybindingId | null>(null);
  const [saved, setSaved] = useState(false);

  const conflicts = findConflicts(draft);
  const hasConflict = conflicts.size > 0;
  const dirty = KEYBINDINGS.some(
    (binding) => !binding.reserved && draft[binding.id] !== savedMap[binding.id],
  );

  function setCombo(id: KeybindingId, combo: string) {
    setSaved(false);
    setDraft((current) => ({ ...current, [id]: combo }));
  }

  function onCaptureKeyDown(
    event: ReactKeyboardEvent<HTMLButtonElement>,
    id: KeybindingId,
  ) {
    // Not capturing yet: only Enter/Space arms capture, so merely tabbing onto
    // the button (or any other key) never starts a capture (issue #445).
    if (capturingId !== id) {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        setCapturingId(id);
      }
      return;
    }
    // Tab leaves the field and cancels capture instead of being bound, so the
    // user can move focus normally while armed.
    if (event.key === "Tab") {
      setCapturingId(null);
      return;
    }
    // Escape cancels capture without changing the binding.
    if (event.key === "Escape") {
      event.preventDefault();
      setCapturingId(null);
      (event.target as HTMLButtonElement).blur();
      return;
    }
    const combo = comboFromEvent(event);
    if (!combo) return; // modifier-only press: keep waiting
    event.preventDefault();
    setCombo(id, combo);
    setCapturingId(null);
  }

  function resetOne(id: KeybindingId) {
    setCombo(id, defaults[id]);
  }

  function resetAll() {
    setSaved(false);
    setDraft(defaultKeybindingMap());
  }

  function onSave() {
    if (hasConflict) return;
    const overrides: Partial<KeybindingMap> = {};
    for (const binding of KEYBINDINGS) {
      if (binding.reserved) continue;
      overrides[binding.id] = draft[binding.id];
    }
    saveKeybindingOverrides(overrides);
    const next = resolveKeybindings();
    setSavedMap(next);
    setDraft(next);
    setSaved(true);
  }

  // Group bindings for display in declaration order.
  const groups: { group: string; ids: KeybindingId[] }[] = [];
  for (const binding of KEYBINDINGS) {
    let bucket = groups.find((g) => g.group === binding.group);
    if (!bucket) {
      bucket = { group: binding.group, ids: [] };
      groups.push(bucket);
    }
    bucket.ids.push(binding.id);
  }
  const bindingById = new Map(KEYBINDINGS.map((b) => [b.id, b]));

  return (
    <div className="rounded-md border border-border bg-card">
      <div className="border-b border-border px-3 py-2">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-secondary">
            <Keyboard className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-base font-semibold">Keyboard shortcuts</h2>
            <p className="text-sm text-muted-foreground">
              Reassign app-level shortcuts. Focus a shortcut and press the new key combination.
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-3 p-3">
        {groups.map(({ group, ids }) => (
          <div key={group} className="grid gap-1">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {group}
            </p>
            {ids.map((id) => {
              const binding = bindingById.get(id)!;
              const conflictIds = conflicts.get(id);
              const reserved = binding.reserved ?? false;
              const isDefault = draft[id] === defaults[id];
              return (
                <div key={id} className="grid gap-1">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm">{binding.label}</span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={reserved}
                        aria-label={`Shortcut for ${binding.label}${
                          capturingId === id ? " (press keys, Esc to cancel)" : " (Enter to rebind)"
                        }`}
                        onClick={() => !reserved && setCapturingId(id)}
                        onBlur={() => setCapturingId((current) => (current === id ? null : current))}
                        onKeyDown={(event) => !reserved && onCaptureKeyDown(event, id)}
                        className={`h-8 min-w-[7rem] rounded-md border px-2 text-xs font-mono outline-none focus:ring-2 focus:ring-ring ${
                          conflictIds
                            ? "border-destructive text-destructive"
                            : "border-input bg-background"
                        } ${reserved ? "cursor-not-allowed opacity-60" : ""}`}
                      >
                        {capturingId === id ? "Press keys…" : draft[id] || "—"}
                      </button>
                      <button
                        type="button"
                        disabled={reserved || isDefault}
                        onClick={() => resetOne(id)}
                        className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-accent disabled:opacity-40"
                      >
                        Reset
                      </button>
                    </div>
                  </div>
                  {conflictIds ? (
                    <p role="alert" className="text-xs text-destructive">
                      Conflicts with {conflictIds.map((other) => keybindingLabel(other)).join(", ")}.
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>
        ))}

        {hasConflict ? (
          <p role="alert" className="text-sm text-destructive">
            Resolve the highlighted conflicts before saving.
          </p>
        ) : null}
        {saved ? (
          <p className="text-sm text-green-700 dark:text-green-400">Keyboard shortcuts saved.</p>
        ) : null}

        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={hasConflict || !dirty}
            onClick={onSave}
            className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Keyboard className="h-4 w-4" aria-hidden="true" />
            Save shortcuts
          </button>
          <button
            type="button"
            onClick={resetAll}
            className="inline-flex h-9 items-center rounded-md border border-border px-4 text-sm font-medium hover:bg-accent"
          >
            Reset all to defaults
          </button>
        </div>
      </div>
    </div>
  );
}
