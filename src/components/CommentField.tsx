import { useRef, useState, type ClipboardEvent, type ReactNode, type Ref, type TextareaHTMLAttributes } from "react";
import { commandErrorMessage } from "@/lib/azdoCommands";
import { uploadCommentImage, type CommentImageTarget } from "@/lib/commands/commentImages";
import { Loader2 } from "lucide-react";

export const commentSecondaryButtonClass =
  "rounded border border-border bg-card px-2 py-0.5 text-2xs text-muted-foreground hover:bg-secondary hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50";

/**
 * The one comment input look shared by PR comments/replies/edits, work item
 * comments/edits and agent notes: a bordered textarea (with an optional
 * overlay such as a mention picker) above a single action row — shortcut hint
 * on the left, then status, extra actions, Cancel and the primary submit.
 * Callers keep their own draft, key handling and mention logic.
 */
export function CommentField({
  textareaRef,
  containerRef,
  overlay,
  hint = "Ctrl+Enter to post · Esc to cancel",
  submitLabel,
  submitAriaLabel,
  submitDisabled = false,
  pending = false,
  onSubmit,
  onCancel,
  cancelDisabled = false,
  extraActions,
  status,
  error,
  showActions = true,
  className = "",
  imageTarget,
  onImagePaste,
  onPaste,
  onKeyDown,
  readOnly,
  ...textareaProps
}: TextareaHTMLAttributes<HTMLTextAreaElement> & {
  textareaRef?: Ref<HTMLTextAreaElement>;
  /** Ref for the `relative` wrapper around the textarea and overlay. */
  containerRef?: Ref<HTMLDivElement>;
  overlay?: ReactNode;
  hint?: string;
  submitLabel: string;
  submitAriaLabel?: string;
  submitDisabled?: boolean;
  pending?: boolean;
  onSubmit: () => void;
  onCancel?: () => void;
  cancelDisabled?: boolean;
  extraActions?: ReactNode;
  status?: ReactNode;
  error?: ReactNode;
  showActions?: boolean;
  imageTarget?: CommentImageTarget;
  onImagePaste?: (text: string, caret: number) => void;
}) {
  const uploading = useRef(false);
  const [imagePending, setImagePending] = useState(false);
  const [imageError, setImageError] = useState<string>();

  async function pasteImage(event: ClipboardEvent<HTMLTextAreaElement>) {
    onPaste?.(event);
    if (event.defaultPrevented || !imageTarget || !onImagePaste || readOnly || pending) return;
    const images = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith("image/"));
    if (!images.length) return;
    event.preventDefault();
    if (uploading.current) return;

    const field = event.currentTarget;
    const { value, selectionStart, selectionEnd } = field;
    uploading.current = true;
    setImagePending(true);
    setImageError(undefined);
    try {
      const links: string[] = [];
      for (const file of images) {
        const url = await uploadCommentImage(imageTarget, file);
        if (!field.isConnected || field.value !== value) return;
        links.push(`![Pasted image](<${url}>)`);
      }
      const inserted = `\n${links.join("\n")}\n`;
      const caret = selectionStart + inserted.length;
      onImagePaste(value.slice(0, selectionStart) + inserted + value.slice(selectionEnd), caret);
      requestAnimationFrame(() => field.setSelectionRange(caret, caret));
    } catch (error) {
      if (field.isConnected) setImageError(commandErrorMessage(error));
    } finally {
      uploading.current = false;
      setImagePending(false);
    }
  }

  return (
    <div className="grid gap-1">
      <div ref={containerRef} className="relative">
        <textarea
          ref={textareaRef}
          {...textareaProps}
          readOnly={readOnly || imagePending}
          onPaste={pasteImage}
          onKeyDown={(event) => {
            if (uploading.current && event.key !== "Escape") {
              if (event.key === "Enter") {
                event.preventDefault();
                event.stopPropagation();
              }
              return;
            }
            onKeyDown?.(event);
          }}
          className={`w-full resize-y rounded border border-input bg-background px-2 py-1 text-xs outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring disabled:opacity-50 ${className}`}
        />
        {overlay}
      </div>
      {imagePending ? <p role="status" className="text-xs text-muted-foreground">Uploading image…</p> : null}
      {imageError ? <p role="alert" className="text-xs text-destructive">{imageError}</p> : null}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      {showActions ? (
        <div className="flex items-center gap-1.5">
          <span className="mr-auto text-2xs text-muted-foreground">{hint}{imageTarget ? " · Ctrl+V to paste an image" : ""}</span>
          {status}
          {extraActions}
          {onCancel ? (
            <button
              type="button"
              onClick={onCancel}
              disabled={cancelDisabled}
              className={commentSecondaryButtonClass}
            >
              Cancel
            </button>
          ) : null}
          <button
            type="button"
            onClick={onSubmit}
            disabled={submitDisabled || pending || imagePending}
            aria-label={submitAriaLabel}
            className="inline-flex items-center gap-1 rounded bg-primary px-2 py-0.5 text-2xs font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> : null}
            {submitLabel}
          </button>
        </div>
      ) : status ? (
        // Keep a status (e.g. "Comment posted") visible after a successful
        // submit collapses the actions row.
        <div role="status" className="flex justify-end">
          {status}
        </div>
      ) : null}
    </div>
  );
}
