// Analyze groups: a named bundle of WIQL queries and repository branches that
// are viewed together. Stored locally like the work item views, since the set a
// person watches is a personal working list rather than shared configuration.

import { clamp } from "@/lib/utils";
import type { BreakdownAxis } from "./analyzeBreakdown";
import {
  isValidMilestoneDate,
  normalizeMilestones,
  type AnalyzeMilestone,
} from "./analyzeMilestones";

const ANALYZE_GROUPS_STORAGE_KEY = "azdodeck:analyze:groups";
const ANALYZE_GROUPS_EXPORT_SCHEMA = "azdodeck.analyzeGroups";

export const MAX_ANALYZE_GROUPS = 20;
/** Queries plus branches within a single group. */
export const MAX_ANALYZE_GROUP_MEMBERS = 12;
/** Enough to describe a plan without letting the target line become noise. */
export const MAX_ANALYZE_MILESTONES = 8;

export const ANALYZE_DAY_RANGES = [7, 30, 90] as const;
export const ANALYZE_WEEK_RANGES = [4, 12, 26] as const;
export const ANALYZE_MONTH_RANGES = [3, 6, 12] as const;

export type AnalyzeGranularity = "day" | "week" | "month";

/** Relative windows that are easier to ask for than a bucket count. */
export type AnalyzeRangePreset = "count" | "thisMonth" | "lastMonth" | "custom";

export type AnalyzeQueryMember = {
  id: string;
  name: string;
  /** Empty means the group's project is used. */
  projectId: string;
  wiql: string;
  /** "By this date, get to this count." Sorted ascending, deduplicated. */
  milestones: AnalyzeMilestone[];
};

export type AnalyzeBranchMember = {
  id: string;
  name: string;
  /** Empty means the group's project is used. */
  projectId: string;
  repositoryId: string;
  repositoryName: string;
  /** Short branch name, without the `refs/heads/` prefix. */
  branch: string;
};

export type AnalyzeGroup = {
  id: string;
  name: string;
  organizationId: string;
  projectId: string;
  queries: AnalyzeQueryMember[];
  branches: AnalyzeBranchMember[];
  granularity: AnalyzeGranularity;
  /** Buckets back from now, in the unit the granularity implies. */
  rangeCount: number;
  /** How the window is chosen; "count" uses `rangeCount`. */
  rangePreset: AnalyzeRangePreset;
  /** `YYYY-MM-DD`, only meaningful when `rangePreset` is "custom". */
  rangeFrom: string;
  rangeTo: string;
  /** Field the breakdown tab groups by. Per group, so switching keeps context. */
  breakdownAxis: BreakdownAxis;
};

export function defaultRangeCount(granularity: AnalyzeGranularity): number {
  return granularity === "day" ? 30 : granularity === "week" ? 12 : 6;
}

export function rangeOptions(granularity: AnalyzeGranularity): readonly number[] {
  return granularity === "day"
    ? ANALYZE_DAY_RANGES
    : granularity === "week"
      ? ANALYZE_WEEK_RANGES
      : ANALYZE_MONTH_RANGES;
}

export function granularityLabel(granularity: AnalyzeGranularity): string {
  return granularity === "day" ? "日" : granularity === "week" ? "週" : "月";
}

function normalizeRangeCount(value: unknown, granularity: AnalyzeGranularity): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return defaultRangeCount(granularity);
  const options = rangeOptions(granularity);
  return clamp(Math.round(parsed), options[0], options[options.length - 1]);
}

function normalizeQueryMember(value: unknown): AnalyzeQueryMember | null {
  if (!value || typeof value !== "object") return null;
  const member = value as Partial<AnalyzeQueryMember>;
  if (typeof member.id !== "string" || !member.id) return null;
  if (typeof member.wiql !== "string" || !member.wiql.trim()) return null;
  return {
    id: member.id,
    name: typeof member.name === "string" && member.name.trim() ? member.name : "Query",
    projectId: typeof member.projectId === "string" ? member.projectId : "",
    wiql: member.wiql,
    milestones: normalizeMilestones(member.milestones).slice(0, MAX_ANALYZE_MILESTONES),
  };
}

function normalizeBranchMember(value: unknown): AnalyzeBranchMember | null {
  if (!value || typeof value !== "object") return null;
  const member = value as Partial<AnalyzeBranchMember>;
  if (typeof member.id !== "string" || !member.id) return null;
  if (typeof member.repositoryId !== "string" || !member.repositoryId) return null;
  const branch = typeof member.branch === "string" ? normalizeBranchName(member.branch) : "";
  if (!branch) return null;
  return {
    id: member.id,
    name: typeof member.name === "string" && member.name.trim() ? member.name : branch,
    projectId: typeof member.projectId === "string" ? member.projectId : "",
    repositoryId: member.repositoryId,
    repositoryName:
      typeof member.repositoryName === "string" ? member.repositoryName : member.repositoryId,
    branch,
  };
}

/** Strips the `refs/heads/` prefix so stored names stay in the short form. */
export function normalizeBranchName(branch: string): string {
  const trimmed = branch.trim();
  return trimmed.startsWith("refs/heads/") ? trimmed.slice("refs/heads/".length) : trimmed;
}

export function normalizeAnalyzeGroup(value: unknown): AnalyzeGroup | null {
  if (!value || typeof value !== "object") return null;
  const group = value as Partial<AnalyzeGroup>;
  if (typeof group.id !== "string" || !group.id) return null;
  if (typeof group.name !== "string" || !group.name.trim()) return null;

  const granularity: AnalyzeGranularity =
    group.granularity === "week" ? "week" : group.granularity === "month" ? "month" : "day";
  const queries = Array.isArray(group.queries)
    ? group.queries.map(normalizeQueryMember).filter((m): m is AnalyzeQueryMember => m !== null)
    : [];
  const branches = Array.isArray(group.branches)
    ? group.branches.map(normalizeBranchMember).filter((m): m is AnalyzeBranchMember => m !== null)
    : [];

  return {
    id: group.id,
    name: group.name,
    organizationId: typeof group.organizationId === "string" ? group.organizationId : "",
    projectId: typeof group.projectId === "string" ? group.projectId : "",
    // Members share one budget so a group cannot fan out into an unbounded
    // number of requests; queries are kept first because they cost more.
    queries: queries.slice(0, MAX_ANALYZE_GROUP_MEMBERS),
    branches: branches.slice(0, Math.max(0, MAX_ANALYZE_GROUP_MEMBERS - queries.length)),
    granularity,
    rangeCount: normalizeRangeCount(group.rangeCount, granularity),
    rangePreset: normalizeRangePreset(group.rangePreset),
    rangeFrom: normalizeRangeDate(group.rangeFrom),
    rangeTo: normalizeRangeDate(group.rangeTo),
    breakdownAxis: normalizeBreakdownAxis(group.breakdownAxis),
  };
}

function normalizeRangePreset(value: unknown): AnalyzeRangePreset {
  return value === "thisMonth" || value === "lastMonth" || value === "custom" ? value : "count";
}

/** Groups saved before the axis was selectable fall back to the assignee view. */
function normalizeBreakdownAxis(value: unknown): BreakdownAxis {
  return value === "state" || value === "workItemType" ? value : "assignedTo";
}

function normalizeRangeDate(value: unknown): string {
  return typeof value === "string" && isValidMilestoneDate(value) ? value : "";
}

export function loadAnalyzeGroups(): AnalyzeGroup[] {
  if (typeof window === "undefined") return [];
  const raw = window.localStorage.getItem(ANALYZE_GROUPS_STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(normalizeAnalyzeGroup)
      .filter((group): group is AnalyzeGroup => group !== null)
      .slice(0, MAX_ANALYZE_GROUPS);
  } catch {
    return [];
  }
}

export function saveAnalyzeGroups(groups: AnalyzeGroup[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    ANALYZE_GROUPS_STORAGE_KEY,
    JSON.stringify(groups.slice(0, MAX_ANALYZE_GROUPS)),
  );
}

export function createAnalyzeGroupId(): string {
  return `grp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createAnalyzeMemberId(): string {
  return `mbr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function groupMemberCount(group: AnalyzeGroup): number {
  return group.queries.length + group.branches.length;
}

/** A group with nothing to show is not worth saving; either side alone is fine. */
export function isAnalyzeGroupComplete(group: AnalyzeGroup): boolean {
  return group.name.trim().length > 0 && groupMemberCount(group) > 0;
}

export type AnalyzeGroupsExport = {
  schema: typeof ANALYZE_GROUPS_EXPORT_SCHEMA;
  version: 1;
  exportedAt: string;
  groups: AnalyzeGroup[];
};

export function createAnalyzeGroupsExport(groups: AnalyzeGroup[]): AnalyzeGroupsExport {
  return {
    schema: ANALYZE_GROUPS_EXPORT_SCHEMA,
    version: 1,
    exportedAt: new Date().toISOString(),
    groups,
  };
}

export function parseAnalyzeGroupsImport(text: string): AnalyzeGroup[] {
  const parsed = JSON.parse(text);
  const raw: unknown[] | null = Array.isArray(parsed)
    ? parsed
    : parsed?.schema === ANALYZE_GROUPS_EXPORT_SCHEMA && Array.isArray(parsed.groups)
      ? parsed.groups
      : null;
  if (!raw) throw new Error("JSON must be a DevDeck analyze group export.");
  const groups = raw
    .map(normalizeAnalyzeGroup)
    .filter((group): group is AnalyzeGroup => group !== null);
  if (groups.length === 0) throw new Error("No valid analyze groups found in JSON.");
  return groups.slice(0, MAX_ANALYZE_GROUPS);
}
