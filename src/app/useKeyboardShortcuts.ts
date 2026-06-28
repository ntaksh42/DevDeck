import { type Dispatch, type SetStateAction, useEffect, useRef } from "react";
import { matchesCombo, normalizeKey, type KeybindingMap } from "@/lib/keybindings";
import {
  isEditableTarget,
  focusWorkItemCommentInput,
  focusFilterInput,
  focusPrimaryGrid,
  focusPrimaryPreview,
  focusViewsPanel,
} from "@/lib/utils";
import { dispatchWorkItemCommand, gotoViewMapFromKeybindings } from "./appHelpers";
import { GOTO_CHAIN_TIMEOUT_MS } from "./types";
import type { View } from "./types";

export interface UseKeyboardShortcutsParams {
  activeView: View;
  organizationsLength: number;
  syncPending: boolean;
  syncAll: () => void;
  keybindings: KeybindingMap;
  navigateHistory: (dir: "back" | "forward") => void;
  openCommandPalette: () => void;
  openHelp: () => void;
  closeHelp: () => void;
  closeCommandPalette: () => void;
  setView: (view: View) => void;
  setSidebarCollapsed: Dispatch<SetStateAction<boolean>>;
  refreshCurrentView: () => void;
  focusNavigation: () => void;
}

export function useKeyboardShortcuts({
  activeView,
  organizationsLength,
  syncPending,
  syncAll,
  keybindings,
  navigateHistory,
  openCommandPalette,
  openHelp,
  closeHelp,
  closeCommandPalette,
  setView,
  setSidebarCollapsed,
  refreshCurrentView,
  focusNavigation,
}: UseKeyboardShortcutsParams): void {
  // Stable ref so the effects below don't need syncAll in their dep arrays
  // (it's a new lambda every render). The ref is always current.
  const syncAllRef = useRef(syncAll);
  syncAllRef.current = syncAll;
  // The G chain runs in the capture phase so the second key wins over
  // grid-level single-letter shortcuts (S, P, C, …).
  useEffect(() => {
    let armed = false;
    let timer: number | null = null;

    function disarm() {
      armed = false;
      if (timer !== null) {
        window.clearTimeout(timer);
        timer = null;
      }
    }

    const leaderKey = normalizeKey(keybindings.gotoLeader);
    const gotoViewKeys = gotoViewMapFromKeybindings(keybindings);

    function onKeyDownCapture(event: KeyboardEvent) {
      if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
      if (isEditableTarget(event.target)) {
        disarm();
        return;
      }
      if (armed) {
        const view = gotoViewKeys[normalizeKey(event.key)];
        disarm();
        if (view && (view === "settings" || organizationsLength > 0)) {
          event.preventDefault();
          event.stopPropagation();
          setView(view);
          window.setTimeout(() => focusPrimaryGrid(), 0);
        }
        return;
      }
      if (normalizeKey(event.key) === leaderKey) {
        armed = true;
        timer = window.setTimeout(disarm, GOTO_CHAIN_TIMEOUT_MS);
      }
    }

    window.addEventListener("keydown", onKeyDownCapture, true);
    return () => {
      window.removeEventListener("keydown", onKeyDownCapture, true);
      disarm();
    };
  }, [organizationsLength, keybindings]);

  useEffect(() => {
    const isWorkItemView =
      activeView === "myWorkItems" ||
      activeView === "workItems" ||
      activeView === "workItemViews";

    function onGlobalKeyDown(event: KeyboardEvent) {
      // Alt+Left / Alt+Right: browser-like back/forward through visited views.
      if (
        event.altKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.shiftKey &&
        (event.key === "ArrowLeft" || event.key === "ArrowRight") &&
        !isEditableTarget(event.target)
      ) {
        event.preventDefault();
        navigateHistory(event.key === "ArrowLeft" ? "back" : "forward");
        return;
      }

      if (!event.defaultPrevented && matchesCombo(keybindings.commandPalette, event)) {
        event.preventDefault();
        openCommandPalette();
        return;
      }

      if (!event.defaultPrevented && matchesCombo(keybindings.focusFilter, event)) {
        // Always claim the focus-filter combo so the browser's native find bar
        // never opens. Focusing the filter input is best-effort; views without
        // a filter simply swallow the shortcut instead of behaving
        // inconsistently.
        event.preventDefault();
        focusFilterInput();
        return;
      }

      if (!event.defaultPrevented && matchesCombo(keybindings.refreshCurrentView, event)) {
        event.preventDefault();
        refreshCurrentView();
        return;
      }

      if (!event.defaultPrevented && matchesCombo(keybindings.applyStaged, event)) {
        if (isWorkItemView) {
          event.preventDefault();
          dispatchWorkItemCommand("apply-staged");
        }
        return;
      }

      if (event.defaultPrevented) {
        return;
      }

      // Escape and F1 keep their fixed behavior regardless of overrides.
      if (
        (event.key === "F1" ||
          (!event.ctrlKey && !event.metaKey && matchesCombo(keybindings.help, event))) &&
        !isEditableTarget(event.target)
      ) {
        event.preventDefault();
        openHelp();
        return;
      }

      if (event.key === "Escape" && !event.altKey) {
        if (isEditableTarget(event.target) && focusPrimaryGrid()) {
          event.preventDefault();
          return;
        }
        closeHelp();
        closeCommandPalette();
        return;
      }

      // Focus-move shortcuts are now Ctrl-based, so their letters overlap text
      // editing keys. Skip them while a text input/editor is focused; Escape
      // already returns focus from an editor back to the grid.
      const inEditableTarget = isEditableTarget(event.target);

      if (!inEditableTarget && matchesCombo(keybindings.focusNavigation, event)) {
        event.preventDefault();
        focusNavigation();
        return;
      }

      if (!inEditableTarget && matchesCombo(keybindings.focusGrid, event)) {
        event.preventDefault();
        focusPrimaryGrid();
        return;
      }

      if (!inEditableTarget && matchesCombo(keybindings.focusPreview, event)) {
        event.preventDefault();
        focusPrimaryPreview();
        return;
      }

      if (!inEditableTarget && matchesCombo(keybindings.focusViewsPanel, event)) {
        if (activeView === "workItemViews") {
          event.preventDefault();
          focusViewsPanel();
        }
        return;
      }

      if (!inEditableTarget && matchesCombo(keybindings.focusComment, event)) {
        if (isWorkItemView) {
          event.preventDefault();
          focusWorkItemCommentInput();
        }
        return;
      }

      if (matchesCombo(keybindings.syncNow, event)) {
        event.preventDefault();
        if (organizationsLength > 0 && !syncPending) {
          syncAllRef.current();
        }
        return;
      }

      if (matchesCombo(keybindings.openSettings, event)) {
        event.preventDefault();
        setView("settings");
        return;
      }

      if (matchesCombo(keybindings.toggleSidebar, event)) {
        event.preventDefault();
        setSidebarCollapsed((collapsed) => !collapsed);
        return;
      }

      // Suppress WebView/browser default shortcuts the app does not bind so
      // they cannot leak through as native behavior (Ctrl+P print dialog,
      // Ctrl+G find-next). Reached only after every app keybinding above has
      // had a chance to claim the event, so user-customized bindings still win.
      // Editable targets keep their normal text-editing path untouched.
      if (
        (event.ctrlKey || event.metaKey) &&
        !event.altKey &&
        !event.shiftKey &&
        (event.key === "p" ||
          event.key === "P" ||
          event.key === "g" ||
          event.key === "G") &&
        !isEditableTarget(event.target)
      ) {
        event.preventDefault();
      }
    }

    window.addEventListener("keydown", onGlobalKeyDown);
    return () => window.removeEventListener("keydown", onGlobalKeyDown);
  }, [activeView, organizationsLength, syncPending, keybindings, navigateHistory]);
}
