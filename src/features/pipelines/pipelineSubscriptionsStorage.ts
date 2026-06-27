import { isTauriRuntime } from "@/lib/runtime";

const PIPELINE_SUBSCRIPTIONS_STORAGE_KEY = "azdodeck:pipelineSubscriptions";

// Dispatched on `window` after the watch list is saved so same-tab listeners
// (the app-wide watch notifier) can react; the native `storage` event only
// fires in other tabs.
export const PIPELINE_SUBSCRIPTIONS_CHANGED_EVENT = "azdodeck:pipeline-subscriptions-changed";

export const MAX_SUBSCRIPTIONS = 100;

const DEMO_SUBSCRIPTIONS: PipelineSubscription[] = [
  {
    organizationId: "contoso",
    projectId: "demo-project",
    projectName: "Demo Project",
    definitionId: 1,
    definitionName: "CI",
  },
  {
    organizationId: "contoso",
    projectId: "demo-project",
    projectName: "Demo Project",
    definitionId: 2,
    definitionName: "Nightly",
  },
];

export type PipelineSubscription = {
  organizationId: string;
  projectId: string;
  projectName: string;
  definitionId: number;
  definitionName: string;
};

export function subscriptionKey(
  organizationId: string,
  projectId: string,
  definitionId: number,
): string {
  return `${organizationId} ${projectId} ${definitionId}`;
}

function keyOf(sub: PipelineSubscription): string {
  return subscriptionKey(sub.organizationId, sub.projectId, sub.definitionId);
}

function normalizeSubscription(value: unknown): PipelineSubscription | null {
  if (!value || typeof value !== "object") return null;
  const sub = value as PipelineSubscription;
  const definitionId = Number(sub.definitionId);
  if (
    typeof sub.organizationId !== "string" ||
    sub.organizationId === "" ||
    typeof sub.projectId !== "string" ||
    sub.projectId === "" ||
    typeof sub.projectName !== "string" ||
    typeof sub.definitionName !== "string" ||
    !Number.isFinite(definitionId)
  ) {
    return null;
  }
  return {
    organizationId: sub.organizationId,
    projectId: sub.projectId,
    projectName: sub.projectName,
    definitionId,
    definitionName: sub.definitionName,
  };
}

export function loadPipelineSubscriptions(): PipelineSubscription[] {
  if (typeof window === "undefined") return [];
  const value = window.localStorage.getItem(PIPELINE_SUBSCRIPTIONS_STORAGE_KEY);
  if (value === null) {
    // ブラウザ/デモ起動で一度も保存が無いときだけ、初期 Watch 済みデモを返す。
    // 本番 (Tauri) には初期値を入れない。空配列を保存済みの場合は尊重する。
    return isTauriRuntime() ? [] : DEMO_SUBSCRIPTIONS.map((sub) => ({ ...sub }));
  }
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    const subscriptions: PipelineSubscription[] = [];
    for (const entry of parsed) {
      const sub = normalizeSubscription(entry);
      if (!sub) continue;
      const key = keyOf(sub);
      if (seen.has(key)) continue;
      seen.add(key);
      subscriptions.push(sub);
    }
    return subscriptions;
  } catch {
    return [];
  }
}

export function savePipelineSubscriptions(subscriptions: PipelineSubscription[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    PIPELINE_SUBSCRIPTIONS_STORAGE_KEY,
    JSON.stringify(subscriptions.slice(0, MAX_SUBSCRIPTIONS)),
  );
  window.dispatchEvent(new Event(PIPELINE_SUBSCRIPTIONS_CHANGED_EVENT));
}

export function isSubscribed(
  subscriptions: PipelineSubscription[],
  organizationId: string,
  projectId: string,
  definitionId: number,
): boolean {
  const key = subscriptionKey(organizationId, projectId, definitionId);
  return subscriptions.some((sub) => keyOf(sub) === key);
}

export type AddSubscriptionResult = {
  // "exists": the candidate was already watched; "limit": the watch list is
  // full so the candidate was not added. Both leave `subscriptions` unchanged.
  status: "added" | "exists" | "limit";
  subscriptions: PipelineSubscription[];
};

export function addSubscription(
  subscriptions: PipelineSubscription[],
  candidate: PipelineSubscription,
): AddSubscriptionResult {
  const key = keyOf(candidate);
  if (subscriptions.some((sub) => keyOf(sub) === key)) {
    return { status: "exists", subscriptions };
  }
  if (subscriptions.length >= MAX_SUBSCRIPTIONS) {
    return { status: "limit", subscriptions };
  }
  return { status: "added", subscriptions: [...subscriptions, candidate] };
}

export function removeSubscription(
  subscriptions: PipelineSubscription[],
  organizationId: string,
  projectId: string,
  definitionId: number,
): PipelineSubscription[] {
  const key = subscriptionKey(organizationId, projectId, definitionId);
  return subscriptions.filter((sub) => keyOf(sub) !== key);
}
