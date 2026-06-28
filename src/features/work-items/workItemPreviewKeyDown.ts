import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import {
  focusPrimaryGrid,
  focusWorkItemCommentInput,
  isEditableTarget,
} from '@/lib/utils';
import type { WorkItemPreview } from '@/lib/azdoCommands';
import type { StagedEntry, StagedChanges } from './workItemChanges';
import type { WorkItemFieldPreset } from './fieldPresetsStorage';
import type { WorkItemDuplicateDraft } from './workItemChanges';

/**
 * Builds the onKeyDown handler for the preview panel aside element.
 * Extracted so the main component stays under 500 lines; all values are passed
 * in as plain arguments (no hooks, pure function).
 */
export function makeWorkItemPreviewKeyDown({
  applyStaged,
  discardStaged,
  undoLastApply,
  undoState,
  stagedEntries,
  presets,
  applyPreset,
  statePickerOpen,
  assigneeOpen,
  reasonEditorOpen,
  priorityPickerOpen,
  customFieldEditor,
  setStatePickerOpen,
  setAssigneeOpen,
  setReasonEditorOpen,
  setPriorityPickerOpen,
  setAssigneeQuery,
  openNextCustomField,
  onDuplicate,
  preview,
  duplicateSelected,
}: {
  applyStaged: () => Promise<void>;
  discardStaged: () => void;
  undoLastApply: () => Promise<void>;
  undoState: { changes: StagedChanges; workItemId: number; count: number } | null;
  stagedEntries: StagedEntry[];
  presets: WorkItemFieldPreset[];
  applyPreset: (preset: WorkItemFieldPreset) => void;
  statePickerOpen: boolean;
  assigneeOpen: boolean;
  reasonEditorOpen: boolean;
  priorityPickerOpen: boolean;
  customFieldEditor: string | null;
  setStatePickerOpen: (open: boolean) => void;
  setAssigneeOpen: (open: boolean) => void;
  setReasonEditorOpen: (open: boolean) => void;
  setPriorityPickerOpen: (open: boolean) => void;
  setAssigneeQuery: (query: string) => void;
  openNextCustomField: () => void;
  onDuplicate: ((draft: WorkItemDuplicateDraft) => void) | undefined;
  preview: WorkItemPreview | null;
  duplicateSelected: () => void;
}) {
  return function handlePreviewPanelKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    if (
      (event.ctrlKey || event.metaKey) &&
      !event.altKey &&
      !event.shiftKey &&
      (event.key === "s" || event.key === "S")
    ) {
      event.preventDefault();
      event.stopPropagation();
      void applyStaged();
      return;
    }

    if (
      isEditableTarget(event.target) ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey
    ) {
      return;
    }

    if (
      event.key === "Escape" &&
      !statePickerOpen &&
      !assigneeOpen &&
      !reasonEditorOpen &&
      !priorityPickerOpen &&
      !customFieldEditor
    ) {
      event.preventDefault();
      event.stopPropagation();
      if (stagedEntries.length > 0) {
        discardStaged();
      } else {
        focusPrimaryGrid();
      }
      return;
    }

    if (event.key === "s" || event.key === "S") {
      event.preventDefault();
      setStatePickerOpen(true);
      setAssigneeOpen(false);
      setReasonEditorOpen(false);
      setPriorityPickerOpen(false);
    } else if (event.key === "a" || event.key === "A") {
      event.preventDefault();
      setAssigneeOpen(true);
      setStatePickerOpen(false);
      setReasonEditorOpen(false);
      setPriorityPickerOpen(false);
      setAssigneeQuery("");
    } else if (event.key === "p" || event.key === "P") {
      event.preventDefault();
      setPriorityPickerOpen(true);
      setAssigneeOpen(false);
      setReasonEditorOpen(false);
      setStatePickerOpen(false);
    } else if (event.key === "r" || event.key === "R") {
      event.preventDefault();
      setReasonEditorOpen(true);
      setAssigneeOpen(false);
      setStatePickerOpen(false);
      setPriorityPickerOpen(false);
    } else if (event.key === "f" || event.key === "F") {
      event.preventDefault();
      openNextCustomField();
    } else if ((event.key === "d" || event.key === "D") && onDuplicate && preview) {
      event.preventDefault();
      duplicateSelected();
    } else if (event.key === "m" || event.key === "M") {
      event.preventDefault();
      focusWorkItemCommentInput();
    } else if (event.key === "u" || event.key === "U") {
      if (undoState) {
        event.preventDefault();
        void undoLastApply();
      }
    } else if (event.key >= "1" && event.key <= "9") {
      const preset = presets[Number(event.key) - 1];
      if (preset) {
        event.preventDefault();
        applyPreset(preset);
      }
    }
  };
}
