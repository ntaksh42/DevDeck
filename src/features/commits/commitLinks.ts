// Azure Boards links a commit to a work item when its message contains an
// `AB#<id>` mention (the cross-service linking syntax). The "unlinked" filter
// uses the absence of such a reference as its default rule — a starting point
// for surfacing commits that bypassed work-item traceability. Branch-naming or
// PR-based rules are intentionally out of scope for now (see issue #301).
const WORK_ITEM_REFERENCE = /\bAB#\d+/i;

/** True when the commit message references a work item via `AB#<id>`. */
export function hasWorkItemReference(comment: string): boolean {
  return WORK_ITEM_REFERENCE.test(comment);
}
