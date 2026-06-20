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
}: {
  segments?: InlineSegment[];
  text: string;
  kind: DiffLineKind;
}) {
  if (!segments) return <>{text}</>;
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
