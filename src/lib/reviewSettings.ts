// Shared stale-threshold constants. Kept in a standalone module with no other
// imports so both azdoCommands.ts and azdoDemo.ts can use them without forming
// an import cycle (which previously crashed startup with a TDZ error).
export const REVIEW_STALE_THRESHOLD_DAY_OPTIONS = [2, 3, 5, 7] as const;
export const DEFAULT_REVIEW_STALE_THRESHOLD_DAYS = 3;
export const WORK_ITEM_STALE_THRESHOLD_DAY_OPTIONS = [7, 14, 30] as const;
export const DEFAULT_WORK_ITEM_STALE_THRESHOLD_DAYS = 7;
// Auto review / investigation: items started per check and organization.
// Mirrors AUTO_AGENT_MAX_PER_SYNC_* in src-tauri/src/db/settings.rs.
export const AUTO_AGENT_MAX_PER_SYNC_MIN = 1;
export const AUTO_AGENT_MAX_PER_SYNC_MAX = 10;
export const DEFAULT_AUTO_AGENT_MAX_PER_SYNC = 10;
