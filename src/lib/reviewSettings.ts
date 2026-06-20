// Shared stale-threshold constants. Kept in a standalone module with no other
// imports so both azdoCommands.ts and azdoDemo.ts can use them without forming
// an import cycle (which previously crashed startup with a TDZ error).
export const REVIEW_STALE_THRESHOLD_DAY_OPTIONS = [2, 3, 5, 7] as const;
export const DEFAULT_REVIEW_STALE_THRESHOLD_DAYS = 3;
export const WORK_ITEM_STALE_THRESHOLD_DAY_OPTIONS = [7, 14, 30] as const;
export const DEFAULT_WORK_ITEM_STALE_THRESHOLD_DAYS = 7;
