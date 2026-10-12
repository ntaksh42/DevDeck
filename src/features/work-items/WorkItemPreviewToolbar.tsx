import { useEffect, useRef, useState } from "react";
import type { WorkItemPreview } from "@/lib/azdoCommands";
import { openMailtoUrl } from "@/lib/openExternal";
import { PreviewToolbar, type PreviewToolbarZoom } from "@/components/PreviewToolbar";
import { buildWorkItemEmailLink } from "./workItemChanges";
import { useWorkItemFollow } from "./useWorkItemFollow";
import { FieldConfigMenu } from "./FieldConfigMenu";
import { PresetMenu } from "./PreviewPresetMenu";

type PresetMenuProps = Omit<React.ComponentProps<typeof PresetMenu>, "open" | "onClose">;
type FieldConfigProps = Omit<React.ComponentProps<typeof FieldConfigMenu>, "open" | "onClose">;

// Tab-strip controls of the work item preview: zoom plus the "⋯" View options
// menu. Follow, share, duplicate, presets, the comments layout and the field
// layout all live in the menu; the last two open their popovers under it.
export function WorkItemPreviewToolbar({
  preview,
  onDuplicate,
  zoom,
  presets,
  sideBySide,
  onToggleCommentsLayout,
  fieldConfig,
}: {
  preview: WorkItemPreview;
  onDuplicate: (() => void) | null;
  zoom: PreviewToolbarZoom;
  presets: PresetMenuProps;
  sideBySide: boolean;
  onToggleCommentsLayout: () => void;
  fieldConfig: FieldConfigProps;
}) {
  const { isFollowed, toggleFollow, pending: followPending } = useWorkItemFollow(preview);
  const [popover, setPopover] = useState<"presets" | "fields" | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const wasOpenRef = useRef(false);

  // A popover opened from the menu hands focus back to the "⋯" trigger when
  // it closes, unless the click that closed it already focused something else.
  useEffect(() => {
    if (popover) {
      wasOpenRef.current = true;
    } else if (wasOpenRef.current) {
      wasOpenRef.current = false;
      const active = document.activeElement;
      if (!active || active === document.body) triggerRef.current?.focus();
    }
  }, [popover]);

  return (
    <PreviewToolbar
      zoom={zoom}
      menuTriggerRef={triggerRef}
      items={[
        { label: "Follow", checked: isFollowed, disabled: followPending, onSelect: toggleFollow },
        { label: "Email a link", onSelect: () => void openMailtoUrl(buildWorkItemEmailLink(preview)) },
        ...(onDuplicate ? [{ label: "Duplicate work item", hint: "D", onSelect: onDuplicate }] : []),
        { label: "Field presets…", hint: "1-9", onSelect: () => setPopover("presets") },
        { label: "Comments beside details", checked: sideBySide, onSelect: onToggleCommentsLayout },
        { label: "Configure preview fields…", onSelect: () => setPopover("fields") },
      ]}
    >
      <PresetMenu {...presets} open={popover === "presets"} onClose={() => setPopover(null)} />
      <FieldConfigMenu {...fieldConfig} open={popover === "fields"} onClose={() => setPopover(null)} />
    </PreviewToolbar>
  );
}
