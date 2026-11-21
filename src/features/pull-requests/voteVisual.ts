// Single source of truth for how a reviewer vote maps to a color tone, shared
// by the My Reviews grid badge, the review panel vote buttons, and the
// reviewer dot so the same vote never renders in different colors.

export type VoteTone = "approved" | "suggestions" | "waiting" | "rejected" | "none";

export function voteTone(vote: number): VoteTone {
  if (vote >= 10) return "approved";
  if (vote >= 5) return "suggestions";
  if (vote === -5) return "waiting";
  if (vote <= -10) return "rejected";
  return "none";
}

/** Filled badge classes (My Reviews grid). */
export const VOTE_BADGE_CLASSES: Record<VoteTone, string> = {
  approved:
    "bg-green-100 text-green-800 border-green-200 dark:border-green-900 dark:bg-green-950 dark:text-green-300",
  suggestions:
    "bg-teal-100 text-teal-800 border-teal-200 dark:border-teal-900 dark:bg-teal-950 dark:text-teal-300",
  waiting:
    "bg-yellow-100 text-yellow-800 border-yellow-200 dark:border-yellow-900 dark:bg-yellow-950 dark:text-yellow-300",
  rejected:
    "bg-red-100 text-red-800 border-red-200 dark:border-red-900 dark:bg-red-950 dark:text-red-300",
  none: "bg-gray-100 text-gray-600 border-gray-200 dark:border-border dark:bg-muted dark:text-muted-foreground",
};

/** Active vote-button classes (review panel). */
export const VOTE_BUTTON_ACTIVE_CLASSES: Record<VoteTone, string> = {
  approved:
    "border-green-400 bg-green-100 text-green-800 dark:border-green-700 dark:bg-green-950 dark:text-green-300",
  suggestions:
    "border-teal-400 bg-teal-100 text-teal-800 dark:border-teal-700 dark:bg-teal-950 dark:text-teal-300",
  waiting:
    "border-yellow-400 bg-yellow-100 text-yellow-800 dark:border-yellow-700 dark:bg-yellow-950 dark:text-yellow-300",
  rejected:
    "border-red-400 bg-red-100 text-red-800 dark:border-red-700 dark:bg-red-950 dark:text-red-300",
  none: "border-gray-400 bg-gray-100 text-gray-700 dark:border-input dark:bg-muted dark:text-foreground",
};

/** Reviewer dot classes (review panel). */
export const VOTE_DOT_CLASSES: Record<VoteTone, string> = {
  approved: "bg-green-500",
  suggestions: "bg-green-500",
  waiting: "bg-yellow-500",
  rejected: "bg-red-500",
  none: "bg-gray-300",
};
