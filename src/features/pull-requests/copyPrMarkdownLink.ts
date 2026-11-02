import { markdownLink } from "@/lib/utils";

/** Copies `[!id title](url)` to the clipboard and reports the outcome via `setToast`. */
export function copyPrMarkdownLink(
  pr: { pullRequestId: number; title: string; webUrl: string | null },
  setToast: (message: string | null) => void,
): void {
  if (!pr.webUrl) return;
  const report = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 1500);
  };
  void navigator.clipboard
    ?.writeText(markdownLink(`!${pr.pullRequestId} ${pr.title}`, pr.webUrl))
    .then(
      () => report("Markdown link copied"),
      () => report("Copy failed"),
    );
}
