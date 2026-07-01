import type React from 'react';
import type { WorkItemSummary } from '@/lib/azdoCommands';
import {
  isEditableTarget,
  focusFilterInput,
  focusPrimaryPreview,
  markdownLink,
} from '@/lib/utils';
import { openExternalUrl } from '@/lib/openExternal';
import { toggleTriageArchived } from '@/lib/triage';
import { workItemSummaryKey, workItemTriageSnapshot, type FilterableColumn } from './workItemsGridHelpers';

export interface WiKeyHandlerDeps {
  selectedIndex: number;
  displayed: WorkItemSummary[];
  checkedIds: Set<string>;
  checkedItems: WorkItemSummary[];
  openFilterCol: FilterableColumn | null;
  triageScope: string | undefined;
  snoozeEnabled: boolean;
  snoozeTargetRef: React.RefObject<WorkItemSummary | null>;
  rowRefs: React.RefObject<(HTMLDivElement | null)[]>;
  moveSelection: (index: number) => void;
  setOpenFilterCol: (col: FilterableColumn | null) => void;
  setFilterAnchorRect: (rect: DOMRect | null) => void;
  setBulkAssignOpen: (open: boolean) => void;
  setBulkStateOpen: (open: boolean) => void;
  setBulkPriorityOpen: (open: boolean) => void;
  setColumnMenuRect: React.Dispatch<React.SetStateAction<DOMRect | null>>;
  setCopyToast: (msg: string | null) => void;
  setFocusCommentRequest: React.Dispatch<React.SetStateAction<number>>;
  setTriageVersion: React.Dispatch<React.SetStateAction<number>>;
  setSnoozeAnchorRect: (rect: DOMRect | null) => void;
  setOpenAssigneeRequest: React.Dispatch<React.SetStateAction<number>>;
  setOpenStateRequest: React.Dispatch<React.SetStateAction<number>>;
  setOpenPriorityRequest: React.Dispatch<React.SetStateAction<number>>;
  setOpenFieldRequest: React.Dispatch<React.SetStateAction<number>>;
  handleCheckboxChange: (index: number, checked: boolean, shiftKey: boolean) => void;
}

export function createWiKeyHandler(deps: WiKeyHandlerDeps): (e: React.KeyboardEvent) => void {
  return (e) => {
    if (e.defaultPrevented) return;
    const {
      selectedIndex, displayed, checkedIds, checkedItems, openFilterCol, triageScope,
      snoozeEnabled, snoozeTargetRef, rowRefs, moveSelection, setOpenFilterCol,
      setFilterAnchorRect, setBulkAssignOpen, setBulkStateOpen, setBulkPriorityOpen,
      setColumnMenuRect, setCopyToast, setFocusCommentRequest, setTriageVersion,
      setSnoozeAnchorRect, setOpenAssigneeRequest, setOpenStateRequest,
      setOpenPriorityRequest, setOpenFieldRequest, handleCheckboxChange,
    } = deps;
    if (isEditableTarget(e.target)) {
      if (e.key === "Escape") {
        e.preventDefault();
        moveSelection(selectedIndex);
      }
      return;
    }
    if (e.key === "Escape") {
      if (openFilterCol) {
        setOpenFilterCol(null);
        setFilterAnchorRect(null);
        return;
      }
      setBulkAssignOpen(false);
      setBulkStateOpen(false);
      setBulkPriorityOpen(false);
      setColumnMenuRect(null);
      return;
    }
    // Single-letter shortcuts must not swallow app-level chords such as
    // Ctrl+K (palette) or Ctrl+S (apply staged changes).
    if (e.ctrlKey || e.metaKey || e.altKey) {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key === "Enter" && displayed.length > 0) {
        e.preventDefault();
        const item = displayed[selectedIndex];
        if (item?.webUrl) openExternalUrl(item.webUrl);
      }
      return;
    }
    if (e.key === "/") {
      e.preventDefault();
      focusFilterInput();
      return;
    }
    if (displayed.length === 0) return;
    if (e.key === "ArrowDown" || e.key === "j" || e.key === "J") {
      e.preventDefault();
      moveSelection(selectedIndex + 1);
    } else if (e.key === "ArrowUp" || e.key === "k" || e.key === "K") {
      e.preventDefault();
      moveSelection(selectedIndex - 1);
    } else if (e.key === "Home") {
      e.preventDefault();
      moveSelection(0);
    } else if (e.key === "End") {
      e.preventDefault();
      moveSelection(displayed.length - 1);
    } else if (e.key === "PageDown") {
      e.preventDefault();
      moveSelection(selectedIndex + 10);
    } else if (e.key === "PageUp") {
      e.preventDefault();
      moveSelection(selectedIndex - 10);
    } else if (e.key === "Enter" || e.key === "ArrowRight") {
      e.preventDefault();
      focusPrimaryPreview();
    } else if (e.key === "o" || e.key === "O") {
      e.preventDefault();
      const item = displayed[selectedIndex];
      if (item?.webUrl) openExternalUrl(item.webUrl);
    } else if (e.key === "c" || e.key === "C") {
      const item = displayed[selectedIndex];
      if (item?.webUrl) {
        void navigator.clipboard.writeText(item.webUrl).then(() => {
          setCopyToast("URL copied");
          window.setTimeout(() => setCopyToast(null), 2000);
        });
      }
    } else if (e.key === "l" || e.key === "L") {
      const item = displayed[selectedIndex];
      if (item?.webUrl) {
        void navigator.clipboard
          .writeText(markdownLink(`#${item.id} ${item.title}`, item.webUrl))
          .then(() => {
            setCopyToast("Markdown link copied");
            window.setTimeout(() => setCopyToast(null), 2000);
          });
      }
    } else if (e.key === " ") {
      e.preventDefault();
      const item = displayed[selectedIndex];
      if (item) {
        const key = `${item.organizationId}:${item.projectId}:${item.id}`;
        handleCheckboxChange(selectedIndex, !checkedIds.has(key), false);
      }
    } else if (e.key === "m" || e.key === "M") {
      e.preventDefault();
      setFocusCommentRequest((value) => value + 1);
    } else if (e.key === "u" || e.key === "U") {
      window.dispatchEvent(new CustomEvent("azdodeck:work-items:undo-apply"));
    } else if ((e.key === "e" || e.key === "E") && triageScope) {
      e.preventDefault();
      const item = displayed[selectedIndex];
      if (item) {
        toggleTriageArchived(
          triageScope,
          workItemSummaryKey(item),
          workItemTriageSnapshot(item),
        );
        setTriageVersion((value) => value + 1);
      }
    } else if ((e.key === "z" || e.key === "Z") && snoozeEnabled) {
      e.preventDefault();
      const item = displayed[selectedIndex];
      if (item) {
        snoozeTargetRef.current = item;
        const rowEl = rowRefs.current[selectedIndex];
        setSnoozeAnchorRect(rowEl?.getBoundingClientRect() ?? null);
      }
    } else if (e.key === "a" || e.key === "A") {
      e.preventDefault();
      if (checkedItems.length > 0) {
        setBulkStateOpen(false);
        setBulkPriorityOpen(false);
        setBulkAssignOpen(true);
      } else {
        setOpenAssigneeRequest((value) => value + 1);
      }
    } else if (e.key === "s" || e.key === "S") {
      e.preventDefault();
      if (checkedItems.length > 0) {
        setBulkAssignOpen(false);
        setBulkPriorityOpen(false);
        setBulkStateOpen(true);
      } else {
        setOpenStateRequest((value) => value + 1);
      }
    } else if (e.key === "p" || e.key === "P") {
      e.preventDefault();
      if (checkedItems.length > 0) {
        setBulkAssignOpen(false);
        setBulkStateOpen(false);
        setBulkPriorityOpen(true);
      } else {
        setOpenPriorityRequest((value) => value + 1);
      }
    } else if (e.key === "f" || e.key === "F") {
      e.preventDefault();
      setOpenFieldRequest((value) => value + 1);
    }
  };
}
