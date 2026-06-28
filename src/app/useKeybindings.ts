import { useEffect, useState } from "react";
import {
  KEYBINDINGS_CHANGED_EVENT,
  resolveKeybindings,
  type KeybindingMap,
} from "@/lib/keybindings";

// Reactively reads the resolved keybinding map and refreshes when overrides
// change (settings emit KEYBINDINGS_CHANGED_EVENT).
export function useKeybindings(): KeybindingMap {
  const [keybindings, setKeybindings] = useState<KeybindingMap>(resolveKeybindings);
  useEffect(() => {
    function onChange() {
      setKeybindings(resolveKeybindings());
    }
    window.addEventListener(KEYBINDINGS_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(KEYBINDINGS_CHANGED_EVENT, onChange);
  }, []);
  return keybindings;
}
