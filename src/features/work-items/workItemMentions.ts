import type {
  MentionCandidate,
  Organization,
  WorkItemAssigneeCandidate,
  WorkItemPreview,
} from "@/lib/azdoCommands";

/**
 * Pure logic for the @mention experience in the comment composer: deriving
 * recent participants from a work item, ranking/de-duplicating candidates,
 * locating the active mention token in the textarea, and rendering Azure
 * DevOps mention markdown. Kept out of the component so it can be unit-tested.
 */

export function recentWorkItemMentionCandidates(
  preview: WorkItemPreview | null,
): MentionCandidate[] {
  if (!preview) return [];
  const candidates = new Map<string, MentionCandidate>();
  for (const comment of preview.comments) {
    if (!comment.createdById || !comment.createdBy) continue;
    if (isAzureDevOpsServiceIdentityName(comment.createdBy, comment.createdByUniqueName)) {
      continue;
    }
    candidates.set(comment.createdById, {
      id: comment.createdById,
      displayName: comment.createdBy,
      uniqueName: comment.createdByUniqueName ?? null,
    });
  }
  return [...candidates.values()];
}

export function recentWorkItemAssigneeCandidates(
  preview: WorkItemPreview | null,
): WorkItemAssigneeCandidate[] {
  if (!preview) return [];
  return recentWorkItemMentionCandidates(preview)
    .filter((candidate) => candidate.uniqueName)
    .map((candidate) => ({
      ...candidate,
      assignValue: `${candidate.displayName} <${candidate.uniqueName}>`,
    }));
}

export function sortSelfLast<T extends MentionCandidate>(
  candidates: T[],
  org: Organization | undefined,
): T[] {
  return [
    ...candidates.filter((candidate) => !isSelfIdentity(candidate, org)),
    ...candidates.filter((candidate) => isSelfIdentity(candidate, org)),
  ];
}

export function isSelfIdentity(
  candidate: MentionCandidate,
  org: Organization | undefined,
): boolean {
  if (!org) return false;
  const uid = org.authenticatedUserId?.toLowerCase() ?? "";
  const selfUnique = org.authenticatedUserUniqueName?.toLowerCase() ?? "";
  const dn = org.authenticatedUserDisplayName?.toLowerCase() ?? "";
  const cid = candidate.id.toLowerCase();
  const cdisplay = candidate.displayName.toLowerCase();
  const cunique = candidate.uniqueName?.toLowerCase() ?? "";
  if (uid !== "" && (cid === uid || (cunique !== "" && cunique === uid))) {
    return true;
  }
  if (selfUnique !== "" && cunique !== "" && cunique === selfUnique) {
    return true;
  }
  if (dn !== "" && cdisplay === dn) {
    // Same display name but a unique name that belongs to someone else:
    // a namesake colleague must stay in the candidate list.
    const provablyDifferent =
      selfUnique !== "" && cunique !== "" && cunique !== selfUnique;
    return !provablyDifferent;
  }
  return false;
}

export function workItemMentionPriorityNames(preview: WorkItemPreview | null): string[] {
  if (!preview) return [];
  const names = [
    ...preview.comments.map((comment) => comment.createdBy),
    preview.createdBy,
    preview.assignedTo,
  ];
  return uniqueNormalizedNames(names);
}

export function rankMentionCandidates<T extends MentionCandidate>({
  recent,
  remote,
  query,
  priorityNames,
}: {
  recent: T[];
  remote: T[];
  query: string;
  priorityNames: string[];
}): T[] {
  const term = query.trim().toLowerCase();
  const recentIndexes = buildMentionCandidateIndex(recent);
  const priority = new Map(priorityNames.map((name, index) => [name, index]));
  const remoteIndex = new Map(remote.map((candidate, index) => [candidate.id, index]));
  const candidates: T[] = [];

  for (const candidate of [...recent, ...remote]) {
    const existingIndex = candidates.findIndex((existing) =>
      isSameMentionCandidate(existing, candidate),
    );
    if (existingIndex === -1) {
      candidates.push(candidate);
    } else {
      candidates[existingIndex] = preferMentionCandidate(
        candidates[existingIndex],
        candidate,
      );
    }
  }

  return candidates
    .filter((candidate) => mentionCandidateMatches(candidate, term))
    .sort((left, right) => {
      const leftRecent = mentionCandidateIndexValue(recentIndexes, left);
      const rightRecent = mentionCandidateIndexValue(recentIndexes, right);
      if (leftRecent !== rightRecent) return leftRecent - rightRecent;

      const leftPriority =
        priority.get(normalizeMentionName(left.displayName)) ?? Number.MAX_SAFE_INTEGER;
      const rightPriority =
        priority.get(normalizeMentionName(right.displayName)) ?? Number.MAX_SAFE_INTEGER;
      if (leftPriority !== rightPriority) return leftPriority - rightPriority;

      const leftStarts = mentionCandidateStartsWith(left, term) ? 0 : 1;
      const rightStarts = mentionCandidateStartsWith(right, term) ? 0 : 1;
      if (leftStarts !== rightStarts) return leftStarts - rightStarts;

      const leftRemote = remoteIndex.get(left.id) ?? Number.MAX_SAFE_INTEGER;
      const rightRemote = remoteIndex.get(right.id) ?? Number.MAX_SAFE_INTEGER;
      if (leftRemote !== rightRemote) return leftRemote - rightRemote;

      return left.displayName.localeCompare(right.displayName);
    })
    .slice(0, 8);
}

function buildMentionCandidateIndex(
  candidates: MentionCandidate[],
): Map<string, number> {
  const index = new Map<string, number>();
  candidates.forEach((candidate, candidateIndex) => {
    for (const key of mentionCandidateIdentityKeys(candidate)) {
      if (!index.has(key)) index.set(key, candidateIndex);
    }
  });
  return index;
}

function mentionCandidateIndexValue(
  index: Map<string, number>,
  candidate: MentionCandidate,
): number {
  let best = Number.MAX_SAFE_INTEGER;
  for (const key of mentionCandidateIdentityKeys(candidate)) {
    best = Math.min(best, index.get(key) ?? Number.MAX_SAFE_INTEGER);
  }
  return best;
}

function mentionCandidateIdentityKeys(candidate: MentionCandidate): string[] {
  return [candidate.id, candidate.uniqueName]
    .map(normalizeMentionName)
    .filter((key): key is string => Boolean(key));
}

function isSameMentionCandidate(
  left: MentionCandidate,
  right: MentionCandidate,
): boolean {
  if (
    normalizedEquals(left.id, right.id) ||
    normalizedEquals(left.uniqueName, right.uniqueName)
  ) {
    return true;
  }
  // Two candidates with distinct unique names are provably different people,
  // even when they share a display name (namesakes).
  if (bothUniqueNamesDiffer(left.uniqueName, right.uniqueName)) {
    return false;
  }
  return (
    normalizedEquals(left.displayName, right.displayName) ||
    normalizedEquals(left.displayName, right.uniqueName) ||
    normalizedEquals(left.uniqueName, right.displayName)
  );
}

function bothUniqueNamesDiffer(
  left: string | null | undefined,
  right: string | null | undefined,
): boolean {
  const normalizedLeft = normalizeMentionName(left);
  const normalizedRight = normalizeMentionName(right);
  return !!normalizedLeft && !!normalizedRight && normalizedLeft !== normalizedRight;
}

function preferMentionCandidate<T extends MentionCandidate>(left: T, right: T): T {
  const preferred =
    mentionCandidateDisplayScore(right) > mentionCandidateDisplayScore(left)
      ? right
      : left;
  return {
    ...preferred,
    uniqueName: preferred.uniqueName ?? left.uniqueName ?? right.uniqueName,
  };
}

function mentionCandidateDisplayScore(candidate: MentionCandidate): number {
  if (isEmailLikeDisplay(candidate.displayName)) return 0;
  if (candidate.uniqueName) return 2;
  return 1;
}

function normalizedEquals(
  left: string | null | undefined,
  right: string | null | undefined,
): boolean {
  const normalizedLeft = normalizeMentionName(left);
  const normalizedRight = normalizeMentionName(right);
  return !!normalizedLeft && normalizedLeft === normalizedRight;
}

function isEmailLikeDisplay(value: string): boolean {
  return /^[^\s@<>]+@[^\s@<>]+$/.test(value.trim());
}

function isAzureDevOpsServiceIdentityName(
  displayName: string,
  uniqueName: string | null | undefined,
): boolean {
  const normalizedDisplayName = displayName.toLowerCase();
  const normalizedUniqueName = uniqueName?.toLowerCase();
  return (
    normalizedDisplayName.includes(" build service (") ||
    normalizedDisplayName.startsWith("agent pool service") ||
    (normalizedUniqueName?.startsWith("build\\") ?? false) ||
    (normalizedUniqueName?.startsWith("agentpool\\") ?? false) ||
    normalizedUniqueName === "project collection build service"
  );
}

function mentionCandidateMatches(candidate: MentionCandidate, term: string): boolean {
  if (!term) return true;
  return (
    candidate.displayName.toLowerCase().includes(term) ||
    (candidate.uniqueName?.toLowerCase().includes(term) ?? false)
  );
}

function mentionCandidateStartsWith(candidate: MentionCandidate, term: string): boolean {
  if (!term) return true;
  return (
    candidate.displayName.toLowerCase().startsWith(term) ||
    (candidate.uniqueName?.toLowerCase().startsWith(term) ?? false)
  );
}

function uniqueNormalizedNames(values: Array<string | null | undefined>): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = normalizeMentionName(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    names.push(normalized);
  }
  return names;
}

function normalizeMentionName(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

// Attached to the active option only, so React re-runs it whenever the
// arrow keys move the highlight and the option scrolls into view.
export function scrollMentionOptionIntoView(element: HTMLButtonElement | null) {
  element?.scrollIntoView?.({ block: "nearest" });
}

export type SelectedMention = {
  id: string;
  displayName: string;
  uniqueName: string | null;
};

export function activeMentionAt(
  text: string,
  cursor: number,
): { start: number; query: string } | null {
  const beforeCursor = text.slice(0, cursor);
  // Allow one internal space so "姓 名" style full names remain searchable.
  // The second word needs at least one character so a trailing space (as
  // inserted right after applying a mention) closes the picker.
  const match = /(^|\s)@([^\s@<>]{1,40}(?: [^\s@<>]{1,40})?|)$/.exec(beforeCursor);
  if (!match) return null;
  return {
    start: beforeCursor.length - (match[2].length + 1),
    query: match[2],
  };
}

// If the text directly before `cursor` is an inserted mention token
// ("@Display Name" with an optional trailing space), returns the index of its
// "@" so Backspace can remove the whole token instead of breaking the display
// name one character at a time. The longest matching name wins.
export function mentionTokenDeletionStart(
  text: string,
  cursor: number,
  displayNames: readonly string[],
): number | null {
  if (cursor <= 0) return null;
  const before = text.slice(0, cursor);
  let start: number | null = null;
  for (const displayName of displayNames) {
    const name = displayName.trim();
    if (!name) continue;
    for (const token of [`@${name} `, `@${name}`]) {
      if (before.endsWith(token)) {
        const tokenStart = cursor - token.length;
        if (start === null || tokenStart < start) start = tokenStart;
      }
    }
  }
  return start;
}

export function addSelectedMention(
  mentions: SelectedMention[],
  candidate: MentionCandidate,
): SelectedMention[] {
  if (mentions.some((mention) => mention.id === candidate.id)) {
    return mentions;
  }
  return [
    ...mentions,
    { id: candidate.id, displayName: candidate.displayName, uniqueName: candidate.uniqueName },
  ];
}

// Azure DevOps only resolves @<id> markdown mentions for storage-key GUIDs;
// any other token is silently dropped from the posted comment. Keeping the
// plain "@Name" text is strictly better than losing it.
const MENTION_RESOLVABLE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isMentionResolvableId(id: string): boolean {
  return MENTION_RESOLVABLE_ID_PATTERN.test(id);
}

// Markdown collapses single newlines into spaces (soft breaks). The comment
// box behaves like the Azure DevOps web UI, where Enter is a visible line
// break, so add hard-break markers outside fenced code blocks.
export function markdownWithHardLineBreaks(text: string): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let inCode = false;
  return lines
    .map((line, index) => {
      if (/^\s*```/.test(line)) {
        inCode = !inCode;
        return line;
      }
      if (inCode || index === lines.length - 1) return line;
      const next = lines[index + 1];
      // Blank lines already separate paragraphs; only single newlines
      // between two text lines need a hard break.
      if (line.trim() === "" || next.trim() === "") return line;
      return `${line}  `;
    })
    .join("\n");
}

export function renderAzureMentionMarkdown(
  text: string,
  mentions: SelectedMention[],
): string {
  let markdown = text;
  const sorted = [...mentions].sort(
    (a, b) => b.displayName.length - a.displayName.length,
  );
  for (const mention of sorted) {
    if (!isMentionResolvableId(mention.id)) continue;
    markdown = markdown.replace(
      mentionTokenPattern(mention.displayName),
      `@<${mention.id}>`,
    );
  }
  return markdown;
}

// Boundary: the next char must not extend a Latin word, so "@Tom" never
// matches inside "@Tomato", while punctuation and CJK text ("@田中さん",
// "@Alice,") still terminate the mention.
export function mentionTokenPattern(displayName: string): RegExp {
  return new RegExp(`@${escapeRegExp(displayName)}(?=$|[^A-Za-z0-9_])`, "g");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
