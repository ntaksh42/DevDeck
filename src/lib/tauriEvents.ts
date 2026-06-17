import { listen } from "@tauri-apps/api/event";
import { isTauriRuntime } from "@/lib/runtime";

/**
 * Boundary for Tauri event subscriptions, mirroring how `azdoCommands.ts` is the
 * boundary for `invoke()`. Components must not import `@tauri-apps/api/event`
 * directly; they subscribe through this helper instead.
 *
 * In the browser dev runtime there is no Tauri event bus, so this is a no-op and
 * returns a cleanup function that does nothing. In the desktop runtime it wires
 * up `listen()` and resolves the unlisten handle into the returned cleanup.
 *
 * The synchronous return shape (`() => void`) keeps it usable directly as a
 * React effect cleanup, even though `listen()` itself is async.
 */
export function subscribeTauriEvent<T>(
  event: string,
  handler: (payload: T) => void,
): () => void {
  if (!isTauriRuntime()) return () => {};

  let unlisten: (() => void) | undefined;
  let cancelled = false;

  listen<T>(event, (e) => handler(e.payload))
    .then((dispose) => {
      // The effect may have already cleaned up before `listen` resolved.
      if (cancelled) {
        dispose();
        return;
      }
      unlisten = dispose;
    })
    .catch((error) => console.error(`failed to subscribe to ${event}`, error));

  return () => {
    cancelled = true;
    unlisten?.();
  };
}
