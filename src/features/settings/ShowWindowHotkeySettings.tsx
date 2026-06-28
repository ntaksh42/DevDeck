import { type FormEvent, type KeyboardEvent as ReactKeyboardEvent, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Keyboard, Loader2 } from 'lucide-react';
import {
  commandErrorMessage,
  getAppSettings,
  updateAppSettings,
} from '@/lib/azdoCommands';
import { settingsInput } from './settingsHelpers';

export function ShowWindowHotkeySettings() {
  const queryClient = useQueryClient();
  const settingsQuery = useQuery({
    queryKey: ["appSettings"],
    queryFn: getAppSettings,
    staleTime: 5 * 60_000,
  });
  const [hotkey, setHotkey] = useState("");

  useEffect(() => {
    setHotkey(settingsQuery.data?.showWindowHotkey ?? "");
  }, [settingsQuery.data?.showWindowHotkey]);

  const mutation = useMutation({
    mutationFn: updateAppSettings,
    onSuccess: (settings) => {
      queryClient.setQueryData(["appSettings"], settings);
    },
  });

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    mutation.mutate(settingsInput(settingsQuery.data, { showWindowHotkey: hotkey }));
  }

  function handleHotkeyKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (
      !event.ctrlKey &&
      !event.altKey &&
      !event.shiftKey &&
      !event.metaKey &&
      (event.key === "Backspace" || event.key === "Delete" || event.key === "Escape")
    ) {
      event.preventDefault();
      setHotkey("");
      return;
    }

    const nextHotkey = hotkeyFromKeyboardEvent(event);
    if (!nextHotkey) return;
    event.preventDefault();
    setHotkey(nextHotkey);
  }

  return (
    <div className="rounded-md border border-border bg-card">
      <div className="border-b border-border px-3 py-2">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-secondary">
            <Keyboard className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-base font-semibold">Show window hotkey</h2>
            <p className="text-sm text-muted-foreground">
              Bring DevDeck to the front from anywhere.
            </p>
          </div>
        </div>
      </div>

      <form className="grid gap-3 p-3" onSubmit={onSubmit}>
        <label className="grid gap-2">
          <span className="text-sm font-medium">Hotkey</span>
          <input
            aria-label="Show window hotkey"
            value={hotkey}
            onChange={(event) => setHotkey(event.target.value)}
            onKeyDown={handleHotkeyKeyDown}
            placeholder="Ctrl+Alt+D"
            className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
        </label>
        <p className="text-xs text-muted-foreground">
          Press a key combination or type it manually. Leave blank to disable.
        </p>

        {settingsQuery.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {commandErrorMessage(settingsQuery.error)}
          </p>
        ) : null}

        {mutation.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {commandErrorMessage(mutation.error)}
          </p>
        ) : null}

        {mutation.isSuccess ? (
          <p className="text-sm text-green-700 dark:text-green-400">Show window hotkey saved.</p>
        ) : null}

        <div>
          <button
            type="submit"
            disabled={settingsQuery.isLoading || mutation.isPending}
            className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {mutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Keyboard className="h-4 w-4" aria-hidden="true" />
            )}
            Save
          </button>
        </div>
      </form>
    </div>
  );
}

function hotkeyFromKeyboardEvent(
  event: ReactKeyboardEvent<HTMLInputElement>,
): string | null {
  const key = normalizeHotkeyKey(event.key);
  if (!key || isModifierKey(key)) return null;

  const parts: string[] = [];
  if (event.ctrlKey) parts.push("Ctrl");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");
  if (event.metaKey) parts.push("Meta");
  if (parts.length === 0) return null;
  parts.push(key);
  return parts.join("+");
}

function normalizeHotkeyKey(key: string): string | null {
  if (!key) return null;
  if (key === " " || key === "Spacebar") return "Space";
  if (key === "Esc") return "Escape";
  if (key.length === 1) return key.toUpperCase();
  return key;
}

function isModifierKey(key: string): boolean {
  return (
    key === "Control" ||
    key === "Ctrl" ||
    key === "Alt" ||
    key === "Shift" ||
    key === "Meta"
  );
}
