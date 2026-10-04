import { AlertTriangle, Ban, Check, HelpCircle, X } from "lucide-react";
import type { ComponentType } from "react";
import { runToneClasses, type RunTone, type RunVisual } from "./pipelineStatus";

// A live pulsing dot so a running pipeline reads at a glance without hunting for
// the blue "Running" badge among the rows.
export function RunningDot() {
  return (
    <span className="relative flex h-2 w-2" aria-hidden="true">
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-500 opacity-75" />
      <span className="relative inline-flex h-2 w-2 rounded-full bg-blue-500" />
    </span>
  );
}

const TONE_ICON: Record<Exclude<RunTone, "active">, ComponentType<{ className?: string }>> = {
  success: Check,
  error: X,
  warning: AlertTriangle,
  canceled: Ban,
  neutral: HelpCircle,
};

/** Status badge: the label stays text, with an icon so tones differ without color. */
export function RunBadge({
  visual,
  size = "sm",
  label,
}: {
  visual: RunVisual;
  size?: "xs" | "sm";
  /** Overrides the visual's label (e.g. "No runs"). */
  label?: string;
}) {
  const Icon = visual.tone === "active" ? null : TONE_ICON[visual.tone];
  return (
    <span
      className={`inline-flex w-fit shrink-0 items-center gap-1 rounded px-1.5 py-px font-medium ${
        size === "xs" ? "text-[11px]" : "text-xs"
      } ${runToneClasses(visual.tone)}`}
    >
      {visual.tone === "active" ? <RunningDot /> : Icon ? <Icon className="h-3 w-3" aria-hidden="true" /> : null}
      {label ?? visual.label}
    </span>
  );
}
