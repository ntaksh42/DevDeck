// "Returned to me" tracking for My Reviews. When the author pushes new changes,
// Azure DevOps resets reviewer votes, so a PR whose vote goes from non-zero
// back to zero is one the ball has bounced back to. We detect that transition
// by diffing successive vote snapshots, persisted locally so it survives a
// restart (a reset that happened while the app was closed is still caught: the
// stored vote was non-zero, the freshly synced vote is zero). The highlight
// clears when the user re-votes or acknowledges the PR by opening it.

import { readStoredJson, storageKey, writeStoredJson } from "@/lib/storage";

const TRACKING_KEY = storageKey("azdodeck:myReviews:returnTracking", 1);

type ReturnEntry = {
  // Last vote we observed for this PR, used to detect the reset transition.
  lastVote: number;
  // When the PR was detected as returned, or null when it is not awaiting me.
  returnedAt: string | null;
  // When the user last acknowledged the return (by opening the PR).
  ackAt: string | null;
};

type ReturnTracking = Record<string, ReturnEntry>;

function load(): ReturnTracking {
  return readStoredJson<ReturnTracking>(
    TRACKING_KEY,
    (raw) => {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
      const result: ReturnTracking = {};
      for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
        if (!value || typeof value !== "object") continue;
        const entry = value as Record<string, unknown>;
        if (typeof entry.lastVote !== "number") continue;
        result[key] = {
          lastVote: entry.lastVote,
          returnedAt: typeof entry.returnedAt === "string" ? entry.returnedAt : null,
          ackAt: typeof entry.ackAt === "string" ? entry.ackAt : null,
        };
      }
      return result;
    },
    {},
  );
}

function save(tracking: ReturnTracking): void {
  writeStoredJson(TRACKING_KEY, tracking);
}

function isAwaitingMe(entry: ReturnEntry): boolean {
  return !!entry.returnedAt && (!entry.ackAt || entry.returnedAt > entry.ackAt);
}

export type ReviewVoteSnapshot = { key: string; myVote: number };

// Reconciles the current vote snapshots against stored state and returns the
// set of PR keys currently "returned to me". Side-effect: persists updated
// tracking and prunes entries for PRs no longer present.
export function reconcileReturns(
  snapshots: ReviewVoteSnapshot[],
  now: Date = new Date(),
): Set<string> {
  const tracking = load();
  const nowIso = now.toISOString();
  const present = new Set<string>();
  const awaiting = new Set<string>();

  for (const { key, myVote } of snapshots) {
    present.add(key);
    const entry = tracking[key] ?? { lastVote: myVote, returnedAt: null, ackAt: null };

    if (myVote !== 0) {
      // I have an active vote again: the ball is no longer in my court.
      entry.returnedAt = null;
      entry.ackAt = null;
    } else if (entry.lastVote !== 0 && !entry.returnedAt) {
      // Vote was reset from non-zero to zero — the author pushed changes.
      entry.returnedAt = nowIso;
    }
    entry.lastVote = myVote;
    tracking[key] = entry;
    if (isAwaitingMe(entry)) awaiting.add(key);
  }

  for (const key of Object.keys(tracking)) {
    if (!present.has(key)) delete tracking[key];
  }
  save(tracking);
  return awaiting;
}

// Marks a returned PR as acknowledged so it stops being highlighted, typically
// when the user opens/selects it.
export function acknowledgeReturn(key: string, now: Date = new Date()): void {
  const tracking = load();
  const entry = tracking[key];
  if (entry?.returnedAt) {
    entry.ackAt = now.toISOString();
    save(tracking);
  }
}

// Browser-demo helper: seed a single PR as returned so the feature is
// reproducible without a live vote-reset. No-op if the key already has tracking
// (so it never overrides real data).
export function seedDemoReturn(key: string, now: Date = new Date()): void {
  const tracking = load();
  if (tracking[key]) return;
  tracking[key] = { lastVote: -5, returnedAt: now.toISOString(), ackAt: null };
  save(tracking);
}
