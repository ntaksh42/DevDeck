import { useEffect, useState } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import {
  loadThemePreference,
  setThemePreference,
  THEME_CHANGED_EVENT,
  type ThemePreference,
} from "@/lib/theme";
import {
  loadUiScale,
  setUiScale,
  UI_SCALE_CHANGED_EVENT,
  UI_SCALE_LEVELS,
  type UiScale,
} from "@/lib/uiScale";
import { SettingsRow } from './SettingsRow';

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

  const [scale, setScale] = useState<UiScale>(loadUiScale);

  // The zoom shortcuts change the scale outside this panel.
  useEffect(() => {
    function onScaleChanged() {
      setScale(loadUiScale());
    }
    window.addEventListener(UI_SCALE_CHANGED_EVENT, onScaleChanged);
    return () => window.removeEventListener(UI_SCALE_CHANGED_EVENT, onScaleChanged);
  }, []);

  function selectTheme(next: ThemePreference) {
    setPreference(next);
    setThemePreference(next);
  }

  return (
    <SettingsRow
      title="Appearance"
      description={<>Choose a theme and the app zoom. System follows your operating system setting.</>}
    >
      <div className="">
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
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                {label}
              </button>
            );
          })}
        </div>

        <div
          role="radiogroup"
          aria-label="UI scale"
          className="mt-3 inline-flex gap-1 rounded-md border border-border bg-muted p-0.5"
        >
          {UI_SCALE_LEVELS.map((level) => (
            <button
              key={level}
              type="button"
              role="radio"
              aria-checked={scale === level}
              onClick={() => setUiScale(level)}
              className={`rounded px-3 py-1.5 text-sm font-medium ${
                scale === level
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {level}%
            </button>
          ))}
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Ctrl+= / Ctrl+- zoom, Ctrl+0 resets.
        </p>
      </div>
    </SettingsRow>
  );
}
