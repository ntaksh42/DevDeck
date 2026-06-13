export type RunTone =
  | "success"
  | "error"
  | "warning"
  | "active"
  | "neutral"
  | "canceled";

export type RunVisual = { label: string; tone: RunTone };

const IN_PROGRESS = new Set(["inprogress", "notstarted", "postponed", "cancelling"]);

export function isInProgressStatus(status: string | null | undefined): boolean {
  return !!status && IN_PROGRESS.has(status.toLowerCase());
}

export function pipelineRunVisual(
  status: string | null | undefined,
  result: string | null | undefined,
): RunVisual {
  const s = (status ?? "").toLowerCase();
  if (s === "cancelling") return { label: "Cancelling", tone: "canceled" };
  if (s && s !== "completed" && s !== "none") return { label: "Running", tone: "active" };
  switch ((result ?? "").toLowerCase()) {
    case "succeeded":
      return { label: "Succeeded", tone: "success" };
    case "failed":
      return { label: "Failed", tone: "error" };
    case "partiallysucceeded":
      return { label: "Partial", tone: "warning" };
    case "canceled":
      return { label: "Canceled", tone: "canceled" };
    default:
      return { label: "Unknown", tone: "neutral" };
  }
}

const TONE_CLASSES: Record<RunTone, string> = {
  success: "bg-emerald-100 text-emerald-800",
  error: "bg-red-100 text-red-800",
  warning: "bg-amber-100 text-amber-800",
  active: "bg-blue-100 text-blue-800",
  canceled: "bg-zinc-200 text-zinc-700",
  neutral: "bg-zinc-100 text-zinc-600",
};

export function runToneClasses(tone: RunTone): string {
  return TONE_CLASSES[tone];
}

export function shortBranch(ref: string | null | undefined): string {
  if (!ref) return "—";
  return ref.replace(/^refs\/heads\//, "");
}

export function formatDuration(
  start: string | null | undefined,
  finish: string | null | undefined,
): string {
  if (!start || !finish) return "—";
  const ms = new Date(finish).getTime() - new Date(start).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return `${minutes}m ${seconds}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}
