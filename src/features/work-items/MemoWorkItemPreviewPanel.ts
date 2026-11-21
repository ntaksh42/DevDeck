import { memo } from "react";
import { WorkItemPreviewPanel } from "./WorkItemPreviewPanel";

/**
 * The preview sits beside the work item grid in the same component, so every
 * grid re-render (a scroll that moves the virtual window, a selection change)
 * re-rendered the whole preview, comments included. Memoized, it only updates
 * when its own props change; callers must pass stable callbacks.
 */
export const MemoWorkItemPreviewPanel = memo(WorkItemPreviewPanel);
