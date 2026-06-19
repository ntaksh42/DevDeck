import { isTauriRuntime } from "@/lib/runtime";

const QUICK_PIPELINES_STORAGE_KEY = "azdodeck:quickPipelines";

const MAX_QUICK_PIPELINES = 50;

export const DEFAULT_QUICK_PIPELINE_BRANCH = "refs/heads/main";

// Browser/demo defaults so the command palette has runnable entries without any
// setup. Production (Tauri) starts empty.
const DEMO_QUICK_PIPELINES: QuickPipeline[] = [
  {
    id: "demo-quick-1",
    name: "Run CI (main)",
    organizationId: "contoso",
    projectId: "demo-project",
    projectName: "Demo Project",
    definitionId: 1,
    definitionName: "CI",
    sourceBranch: "refs/heads/main",
  },
];

export type QuickPipeline = {
  id: string;
  name: string;
  organizationId: string;
  projectId: string;
  projectName: string;
  definitionId: number;
  definitionName: string;
  sourceBranch: string;
};

export type QuickPipelineDraft = Omit<QuickPipeline, "id">;

function generateId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `qp-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeQuickPipeline(value: unknown): QuickPipeline | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<QuickPipeline>;
  const definitionId = Number(candidate.definitionId);
  if (
    typeof candidate.name !== "string" ||
    candidate.name.trim() === "" ||
    typeof candidate.organizationId !== "string" ||
    candidate.organizationId === "" ||
    typeof candidate.projectId !== "string" ||
    candidate.projectId === "" ||
    typeof candidate.projectName !== "string" ||
    typeof candidate.definitionName !== "string" ||
    typeof candidate.sourceBranch !== "string" ||
    candidate.sourceBranch.trim() === "" ||
    !Number.isFinite(definitionId)
  ) {
    return null;
  }
  return {
    id: typeof candidate.id === "string" && candidate.id !== "" ? candidate.id : generateId(),
    name: candidate.name.trim(),
    organizationId: candidate.organizationId,
    projectId: candidate.projectId,
    projectName: candidate.projectName,
    definitionId,
    definitionName: candidate.definitionName,
    sourceBranch: candidate.sourceBranch.trim(),
  };
}

export function loadQuickPipelines(): QuickPipeline[] {
  if (typeof window === "undefined") return [];
  const value = window.localStorage.getItem(QUICK_PIPELINES_STORAGE_KEY);
  if (value === null) {
    return isTauriRuntime() ? [] : DEMO_QUICK_PIPELINES.map((entry) => ({ ...entry }));
  }
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    const pipelines: QuickPipeline[] = [];
    for (const entry of parsed) {
      const pipeline = normalizeQuickPipeline(entry);
      if (!pipeline) continue;
      if (seen.has(pipeline.id)) continue;
      seen.add(pipeline.id);
      pipelines.push(pipeline);
    }
    return pipelines;
  } catch {
    return [];
  }
}

export function saveQuickPipelines(pipelines: QuickPipeline[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    QUICK_PIPELINES_STORAGE_KEY,
    JSON.stringify(pipelines.slice(0, MAX_QUICK_PIPELINES)),
  );
}

export function addQuickPipeline(
  pipelines: QuickPipeline[],
  draft: QuickPipelineDraft,
): QuickPipeline[] {
  const entry: QuickPipeline = { id: generateId(), ...draft, name: draft.name.trim() };
  return [...pipelines, entry].slice(0, MAX_QUICK_PIPELINES);
}

export function removeQuickPipeline(pipelines: QuickPipeline[], id: string): QuickPipeline[] {
  return pipelines.filter((pipeline) => pipeline.id !== id);
}
