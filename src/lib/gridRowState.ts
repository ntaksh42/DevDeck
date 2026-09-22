// Background / edge treatment for a grid row, shared by every result grid so
// "which row is selected" reads the same everywhere.
//
// Selection wins over everything: a primary tint plus a 3px primary bar on the
// leading edge. Staleness is deliberately NOT a row fill (a full orange row
// used to out-shout the selection); it is an orange leading bar, with the age
// cell itself colored by the caller via STALE_TEXT_CLASS.
export function gridRowStateClass({
  selected,
  inMultiSelection = false,
  isStale = false,
  customClass,
}: {
  selected: boolean;
  inMultiSelection?: boolean;
  isStale?: boolean;
  /** User row-color rule (work items); applies only to unselected rows. */
  customClass?: string | null;
}): string {
  if (selected) {
    return "bg-primary/15 shadow-[inset_3px_0_0_hsl(var(--primary))] dark:bg-primary/20";
  }
  if (inMultiSelection) return "bg-primary/[0.07] hover:bg-primary/10";
  if (customClass) return customClass;
  if (isStale) {
    return "shadow-[inset_3px_0_0_theme(colors.orange.500)] hover:bg-muted/50 dark:shadow-[inset_3px_0_0_theme(colors.orange.400)]";
  }
  return "hover:bg-muted/50";
}

export const STALE_TEXT_CLASS = "font-medium text-orange-700 dark:text-orange-300";
