const MAX_SLUG_LENGTH = 40;

/**
 * Default branch name for a work item: `{type}/{id}-{title slug}`, e.g.
 * `bug/123-fix-login-redirect`. The slug keeps letters and digits of any script
 * (so Japanese titles survive), turns everything else into single hyphens and
 * stays within a length that is still readable in a branch list.
 */
export function defaultWorkItemBranchName(
  workItemType: string | null,
  id: number,
  title: string,
): string {
  const slug = (value: string) =>
    value
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-+|-+$/g, "");
  const type = slug(workItemType ?? "") || "work-item";
  const title_ = slug(title).slice(0, MAX_SLUG_LENGTH).replace(/-+$/g, "");
  return `${type}/${id}${title_ ? `-${title_}` : ""}`;
}
