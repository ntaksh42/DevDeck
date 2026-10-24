// Shown instead of an apparently empty diff when only the newline style changed
// (e.g. "LF → CRLF"): the normalized diff has no line changes, but the file did.
export function EolOnlyNotice({ change }: { change: string }) {
  return (
    <p className="border-b border-border bg-info/10 px-2 py-1 text-2xs text-info">
      Only line endings changed ({change}); the text content is identical.
    </p>
  );
}
