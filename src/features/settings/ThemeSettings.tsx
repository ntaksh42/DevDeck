import { useEffect, useState } from 'react';
import { Monitor, Moon, Palette, Sun } from 'lucide-react';
import {
  loadThemePreference,
  setThemePreference,
  THEME_CHANGED_EVENT,
  type ThemePreference,
} from "@/lib/theme";

const THEME_OPTIONS: { value: ThemePreference; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
];

export function ThemeSettings() {
  const [preference, setPreference] = useState<ThemePreference>(loadThemePreference);

  // Reflect changes made elsewhere (e.g. OS scheme follow) without re-reading.
  useEffect(() => {
    function onThemeChanged() {
      setPreference(loadThemePreference());
    }
    window.addEventListener(THEME_CHANGED_EVENT, onThemeChanged);
    return () => window.removeEventListener(THEME_CHANGED_EVENT, onThemeChanged);
  }, []);

  function selectTheme(next: ThemePreference) {
    setPreference(next);
    setThemePreference(next);
  }

  return (
    <div className="rounded-md border border-border bg-card">
      <div className="border-b border-border px-3 py-2">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-secondary">
            <Palette className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-base font-semibold">Appearance</h2>
            <p className="text-sm text-muted-foreground">
              Choose a theme. System follows your operating system setting.
            </p>
          </div>
        </div>
      </div>

      <div className="p-3">
        <div
          role="radiogroup"
          aria-label="Theme"
          className="inline-flex gap-1 rounded-md border border-border bg-muted p-0.5"
        >
          {THEME_OPTIONS.map(({ value, label, icon: Icon }) => {
            const selected = preference === value;
            return (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => selectTheme(value)}
                className={`inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-sm font-medium ${
                  selected
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                {label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
