import { MarkdownView } from "@/lib/markdown";

// A Markdown file opened in the Files view, rendered through the same sanitizing
// pipeline as folder README previews. "Source" switches to the normal code view.
export function CodeMarkdownPreview({
  content,
  onShowSource,
}: {
  content: string;
  onShowSource: () => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-border px-2 py-1 text-xs text-muted-foreground">
        <span className="pl-1 uppercase tracking-wide">Markdown preview</span>
        <button
          type="button"
          onClick={onShowSource}
          title="Show the Markdown source"
          className="rounded px-1 py-0.5 hover:text-foreground"
        >
          Source
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-4">
        <MarkdownView text={content} />
      </div>
    </div>
  );
}
