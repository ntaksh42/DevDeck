import type { DiffLineKind, InlineSegment } from "@/lib/diffView";

/**
 * Renders a diff line's text, applying word-level highlights when `segments`
 * are present. Shared by the PR and commit diff views so both render
 * modifications identically.
 */
export function DiffLineText({
  segments,
  text,
  kind,
  html,
}: {
  segments?: InlineSegment[];
  text: string;
  kind: DiffLineKind;
  /**
   * Sanitized syntax-highlighted HTML for the line (see `highlightLineHtml`).
   * Used only for lines without word-level `segments`, which take precedence so
   * the changed words stay visible.
   */
  html?: string | null;
}) {
  if (!segments) {
    return html ? <span dangerouslySetInnerHTML={{ __html: html }} /> : <>{text}</>;
  }
  const highlight =
    kind === "add"
      ? "rounded-sm bg-green-200/80 dark:bg-green-700/50"
      : "rounded-sm bg-red-200/80 dark:bg-red-700/50";
  return (
    <>
      {segments.map((segment, index) =>
        segment.highlight ? (
          <span key={index} className={highlight}>
            {segment.text}
          </span>
        ) : (
          <span key={index}>{segment.text}</span>
        ),
      )}
    </>
  );
}
