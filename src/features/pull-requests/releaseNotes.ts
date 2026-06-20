import type { ReleaseNotePr } from "@/lib/azdoCommands";

// Renders completed PRs into a Markdown release-notes document, grouped by
// repository (each repo a section, PRs as bullet list with title, #id, author).
export function generateReleaseNotesMarkdown(
  prs: ReleaseNotePr[],
  range?: { fromDate?: string; toDate?: string },
): string {
  if (prs.length === 0) {
    return "No completed pull requests in the selected range.\n";
  }

  const byRepo = new Map<string, ReleaseNotePr[]>();
  for (const pr of prs) {
    const list = byRepo.get(pr.repositoryName) ?? [];
    list.push(pr);
    byRepo.set(pr.repositoryName, list);
  }

  const lines: string[] = ["# Release notes", ""];
  const rangeLabel = [range?.fromDate, range?.toDate].filter(Boolean).join(" – ");
  if (rangeLabel) lines.push(`_${rangeLabel}_`, "");

  for (const [repo, repoPrs] of [...byRepo].sort((a, b) => a[0].localeCompare(b[0]))) {
    lines.push(`## ${repo}`, "");
    for (const pr of repoPrs) {
      const author = pr.createdBy ? ` (@${pr.createdBy})` : "";
      lines.push(`- ${pr.title} (#${pr.pullRequestId})${author}`);
    }
    lines.push("");
  }

  return `${lines.join("\n").trim()}\n`;
}
