import { useEffect, useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { ShortcutHint } from '@/components/ShortcutHint';
import { useCloseOnOutsidePointer } from './PreviewEditors';
import { MAX_FIELD_PRESETS, type WorkItemFieldPreset } from './fieldPresetsStorage';

// Popover half of the "Field presets…" View options item: no trigger of its
// own, the toolbar's menu opens it and gets focus back on `onClose`.
export function PresetMenu({
  open,
  onClose,
  canSave,
  onApply,
  onDelete,
  onSave,
  presets,
  stagedCount,
}: {
  open: boolean;
  onClose: () => void;
  canSave: boolean;
  onApply: (preset: WorkItemFieldPreset) => void;
  onDelete: (id: string) => void;
  onSave: (name: string) => void;
  presets: WorkItemFieldPreset[];
  stagedCount: number;
}) {
  const [name, setName] = useState("");
  const menuRef = useCloseOnOutsidePointer<HTMLDivElement>(open, onClose);
  const popoverRef = useRef<HTMLDivElement>(null);
  // Open onto the first control.
  useEffect(() => {
    if (open) popoverRef.current?.querySelector<HTMLElement>("button, input")?.focus();
  }, [open]);

  return (
    <div
      ref={menuRef}
      className="relative"
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
      }}
    >
      {open ? (
        <div
          ref={popoverRef}
          className="absolute right-0 top-full z-30 mt-1 w-64 rounded-md border border-border bg-popover p-1 shadow-lg"
        >
          <div className="px-2 py-1 text-[11px] font-semibold text-muted-foreground">
            Field presets
          </div>
          {presets.length > 0 ? (
            presets.map((preset, index) => (
              <div
                key={preset.id}
                className="group flex items-center gap-1 rounded hover:bg-muted"
              >
                <button
                  type="button"
                  onClick={() => {
                    onApply(preset);
                    onClose();
                  }}
                  title={preset.fields
                    .map((field) => `${field.label}: ${field.value}`)
                    .join("\n")}
                  className="flex min-w-0 flex-1 items-center gap-1.5 px-2 py-1 text-left text-xs"
                >
                  <ShortcutHint>{index + 1}</ShortcutHint>
                  <span className="truncate">{preset.name}</span>
                </button>
                <button
                  type="button"
                  aria-label={`Delete preset ${preset.name}`}
                  onClick={() => onDelete(preset.id)}
                  className="mr-1 rounded p-0.5 text-muted-foreground opacity-0 hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
                >
                  <Trash2 className="h-3 w-3" aria-hidden="true" />
                </button>
              </div>
            ))
          ) : (
            <p className="px-2 py-1 text-[11px] text-muted-foreground">No presets yet.</p>
          )}
          <div className="mt-1 border-t border-border px-2 py-1.5">
            {canSave ? (
              <form
                className="flex items-center gap-1"
                onSubmit={(event) => {
                  event.preventDefault();
                  const trimmed = name.trim();
                  if (!trimmed) return;
                  onSave(trimmed);
                  setName("");
                }}
              >
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder={`Save ${stagedCount} pending as…`}
                  aria-label="New preset name"
                  className="h-6 min-w-0 flex-1 rounded border border-input bg-background px-1.5 text-xs outline-none focus:border-primary"
                />
                <button
                  type="submit"
                  disabled={!name.trim() || presets.length >= MAX_FIELD_PRESETS}
                  className="h-6 rounded border border-border bg-card px-2 text-xs hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Save
                </button>
              </form>
            ) : (
              <p className="text-[11px] text-muted-foreground">
                Stage changes (state, reason, …), then save them here as a preset.
              </p>
            )}
            {presets.length >= MAX_FIELD_PRESETS ? (
              <p className="mt-1 text-[11px] text-muted-foreground">
                Up to {MAX_FIELD_PRESETS} presets.
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
