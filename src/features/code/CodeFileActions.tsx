import { Check, Copy, Download, WrapText } from "lucide-react";

const buttonClass = "flex items-center gap-1 rounded px-1 py-0.5 text-xs hover:text-foreground";

// The file viewer's view/action buttons: wrap, raw/highlighted, (markdown) rendered
// preview, download and copy. Split out of CodeFileView to keep that file small.
export function CodeFileActions({
  wrap,
  raw,
  copied,
  onToggleWrap,
  onToggleRaw,
  onDownload,
  onCopy,
  onShowRendered,
}: {
  wrap: boolean;
  raw: boolean;
  copied: boolean;
  onToggleWrap: () => void;
  onToggleRaw: () => void;
  onDownload: () => void;
  onCopy: () => void;
  /** Set for Markdown files: switches back to the rendered preview. */
  onShowRendered?: () => void;
}) {
  return (
    <>
      {onShowRendered ? (
        <button
          type="button"
          onClick={onShowRendered}
          title="Show the rendered Markdown"
          className={`${buttonClass} text-muted-foreground`}
        >
          Rendered
        </button>
      ) : null}
      <button
        type="button"
        onClick={onToggleWrap}
        aria-pressed={wrap}
        title={wrap ? "Disable line wrap" : "Wrap long lines"}
        className={`${buttonClass} ${wrap ? "text-foreground" : "text-muted-foreground"}`}
      >
        <WrapText className="h-3.5 w-3.5" aria-hidden="true" /> Wrap
      </button>
      <button
        type="button"
        onClick={onToggleRaw}
        aria-pressed={raw}
        title={raw ? "Show highlighted source" : "Show raw source"}
        className={`${buttonClass} ${raw ? "text-foreground" : "text-muted-foreground"}`}
      >
        {raw ? "Highlighted" : "Raw"}
      </button>
      <button
        type="button"
        onClick={onDownload}
        title="Download file"
        className={`${buttonClass} text-muted-foreground`}
      >
        <Download className="h-3.5 w-3.5" aria-hidden="true" /> Download
      </button>
      <button
        type="button"
        onClick={onCopy}
        title="Copy file contents"
        className={`${buttonClass} text-muted-foreground`}
      >
        {copied ? (
          <Check className="h-3.5 w-3.5 text-green-600" aria-hidden="true" />
        ) : (
          <Copy className="h-3.5 w-3.5" aria-hidden="true" />
        )}
        {copied ? "Copied" : "Copy"}
      </button>
    </>
  );
}

// Shown instead of the content for files that cannot be previewed (binary or
// too large): a message plus a link to the file in Azure DevOps, where it can be
// viewed or downloaded.
export function UnavailableFileNotice({
  message,
  onOpenInBrowser,
}: {
  message: string;
  onOpenInBrowser: () => void;
}) {
  return (
    <div className="flex items-center gap-3 px-3 py-3 text-sm text-muted-foreground">
      <span>{message}</span>
      <button
        type="button"
        onClick={onOpenInBrowser}
        className="font-medium text-link hover:underline"
      >
        Open in Azure DevOps
      </button>
    </div>
  );
}
