import type { KeyboardEvent, RefObject } from "react";
import { isEditableTarget, focusPrimaryPreview } from "@/lib/utils";
import { openAgentPanel } from "@/components/agent/agentSubject";
import { agentRequestOf, isThreadItem, type InboxEntry, type InboxLink, type InboxTab } from "./inboxPresentation";
import type { useInboxChecked } from "./useInboxChecked";
import type { useInboxStateChanges } from "./useInboxStateChanges";
import type { useInboxDetail } from "./useInboxDetail";

export function inboxListKeyHandler({
  selected, entries, index, tab, checked, stateChanges, detail, readOnly,
  filterBar, moveSelectionTo, openInBrowser, openInApp, toggleThreadStatus,
  changeMarkedOrSelected, setContextExpanded, scrollPreview, openSnoozeMenu,
  canGenerateInsight, generateInsight, applyReplyDraft, activatePanel, previewRef, openLink,
}: {
  selected: InboxEntry | null;
  entries: InboxEntry[];
  index: number;
  tab: InboxTab;
  checked: ReturnType<typeof useInboxChecked>;
  stateChanges: ReturnType<typeof useInboxStateChanges>;
  detail: ReturnType<typeof useInboxDetail>;
  readOnly: boolean;
  filterBar: { onOpen: () => void };
  moveSelectionTo: (index: number) => void;
  openInBrowser: (entry: InboxEntry) => void;
  openInApp: (entry: InboxEntry) => void;
  toggleThreadStatus: () => Promise<void>;
  changeMarkedOrSelected: (entry: InboxEntry, state: InboxTab) => void;
  setContextExpanded: (update: (value: boolean) => boolean) => void;
  scrollPreview: (direction: 1 | -1) => void;
  openSnoozeMenu: () => void;
  canGenerateInsight: (entry: InboxEntry | null) => entry is InboxEntry;
  generateInsight: (entry: InboxEntry) => void;
  applyReplyDraft: (text: string) => void;
  activatePanel: (id: "conversation") => void;
  previewRef: RefObject<HTMLDivElement | null>;
  openLink: (link: InboxLink) => void;
}) {
  // M / Ctrl+M, like "Focus comment" in My Reviews and Work Items: the reply
  // box (WI mentions: a Reply to the mentioning comment, else the comment box).
  function focusReply(event: KeyboardEvent) {
    event.preventDefault();
    activatePanel("conversation");
    // Wait for the panel to mount if it was stacked behind the agent's tab.
    window.setTimeout(() => {
      const preview = previewRef.current;
      const target =
        preview?.querySelector<HTMLElement>('[data-inbox-mention-reply="true"], [data-thread-reply="true"]') ??
        preview?.querySelector<HTMLElement>('[data-inbox-composer="true"] textarea');
      if (target instanceof HTMLTextAreaElement) target.focus();
      else target?.click();
    }, 0);
  }

  return function handleListKeyDown(event: KeyboardEvent) {
    if (isEditableTarget(event.target)) return;
    if (event.altKey || event.metaKey) return;
    if (event.ctrlKey) {
      if (event.key === "Enter" && selected) {
        event.preventDefault();
        openInBrowser(selected);
      } else if (event.key.toLowerCase() === "m" && !event.shiftKey && selected) {
        focusReply(event);
      }
      return;
    }
    const key = event.key;
    if (key === "/") {
      event.preventDefault();
      filterBar.onOpen();
      return;
    }
    if (key === "Escape" && checked.ids.size > 0) {
      event.preventDefault();
      checked.clear();
      return;
    }
    if (key.toLowerCase() === "u" && !event.shiftKey) {
      // Works on an emptied list too: undoing the last item brings it back.
      if (stateChanges.undoLast()) event.preventDefault();
      return;
    }
    if (entries.length === 0) return;
    if (event.shiftKey && key === "Enter") {
      event.preventDefault();
      if (selected) openInApp(selected);
      return;
    }
    const lower = key.toLowerCase();
    if (event.shiftKey && (key === "ArrowDown" || key === "ArrowUp")) {
      // Extends the marked range over the row being left and the one entered.
      event.preventDefault();
      const next = index + (key === "ArrowDown" ? 1 : -1);
      checked.add(entries[index], entries[next]);
      moveSelectionTo(next);
    } else if (key === "ArrowDown" || lower === "j") {
      event.preventDefault();
      moveSelectionTo(index + 1);
    } else if (key === "ArrowUp" || lower === "k") {
      event.preventDefault();
      moveSelectionTo(index - 1);
    } else if (key === "Home") {
      event.preventDefault();
      moveSelectionTo(0);
    } else if (key === "End") {
      event.preventDefault();
      moveSelectionTo(entries.length - 1);
    } else if (key === "PageDown") {
      event.preventDefault();
      moveSelectionTo(index + 10);
    } else if (key === "PageUp") {
      event.preventDefault();
      moveSelectionTo(index - 10);
    } else if (key === "Enter" || key === "ArrowRight") {
      event.preventDefault();
      focusPrimaryPreview();
    } else if (!selected) {
      return;
    } else if (lower === "o") {
      event.preventDefault();
      openInBrowser(selected);
    } else if (lower === "e" && event.shiftKey) {
      // Resolve + Done, the same as the preview's button.
      if (tab === "open" && isThreadItem(selected) && detail.thread && !detail.thread.isResolved && !readOnly) {
        event.preventDefault();
        void toggleThreadStatus();
      }
    } else if (lower === "x") {
      event.preventDefault();
      checked.toggle(selected);
    } else if (lower === "e") {
      event.preventDefault();
      changeMarkedOrSelected(selected, tab === "done" ? "open" : "done");
    } else if (lower === "d") {
      event.preventDefault();
      setContextExpanded((value) => !value);
    } else if (key === " ") {
      event.preventDefault();
      scrollPreview(event.shiftKey ? -1 : 1);
    } else if (lower === "z") {
      event.preventDefault();
      if (tab === "snoozed") changeMarkedOrSelected(selected, "open");
      else openSnoozeMenu();
    } else if (lower === "i") {
      if (canGenerateInsight(selected)) {
        event.preventDefault();
        generateInsight(selected);
      }
    } else if (lower === "r" && event.shiftKey) {
      if (selected.insight?.replyDraft) {
        event.preventDefault();
        applyReplyDraft(selected.insight.replyDraft);
      }
    } else if (lower === "m" && !event.shiftKey) {
      focusReply(event);
    } else if (lower === "q") {
      event.preventDefault();
      openAgentPanel(agentRequestOf(selected));
    } else if (lower === "c") {
      event.preventDefault();
      if (selected.webUrl) void navigator.clipboard?.writeText(selected.webUrl);
    } else if (/^[1-9]$/.test(key)) {
      const link = detail.links[Number(key) - 1];
      if (link) {
        event.preventDefault();
        openLink(link);
      }
    }
  };
}
