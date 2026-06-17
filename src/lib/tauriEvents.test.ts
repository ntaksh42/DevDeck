import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const listen = vi.fn();
const isTauriRuntime = vi.fn();

vi.mock("@tauri-apps/api/event", () => ({ listen: (...args: unknown[]) => listen(...args) }));
vi.mock("@/lib/runtime", () => ({ isTauriRuntime: () => isTauriRuntime() }));

import { subscribeTauriEvent } from "./tauriEvents";

describe("subscribeTauriEvent", () => {
  beforeEach(() => {
    listen.mockReset();
    isTauriRuntime.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is a no-op outside the desktop runtime", () => {
    isTauriRuntime.mockReturnValue(false);

    const cleanup = subscribeTauriEvent("sync:updated", () => {});

    expect(listen).not.toHaveBeenCalled();
    expect(() => cleanup()).not.toThrow();
  });

  it("delivers the event payload to the handler", async () => {
    isTauriRuntime.mockReturnValue(true);
    let registered: ((e: { payload: unknown }) => void) | undefined;
    const unlisten = vi.fn();
    listen.mockImplementation(async (_event, handler) => {
      registered = handler;
      return unlisten;
    });

    const handler = vi.fn();
    subscribeTauriEvent<{ scope: string }>("sync:updated", handler);
    await Promise.resolve();

    registered?.({ payload: { scope: "all" } });
    expect(handler).toHaveBeenCalledWith({ scope: "all" });
  });

  it("calls unlisten when cleaned up after listen resolves", async () => {
    isTauriRuntime.mockReturnValue(true);
    const unlisten = vi.fn();
    listen.mockResolvedValue(unlisten);

    const cleanup = subscribeTauriEvent("sync:updated", () => {});
    await Promise.resolve();
    cleanup();

    expect(unlisten).toHaveBeenCalledTimes(1);
  });

  it("disposes the listener when cleanup runs before listen resolves", async () => {
    isTauriRuntime.mockReturnValue(true);
    const unlisten = vi.fn();
    let resolveListen: ((dispose: () => void) => void) | undefined;
    listen.mockImplementation(
      () =>
        new Promise<() => void>((resolve) => {
          resolveListen = resolve;
        }),
    );

    const cleanup = subscribeTauriEvent("sync:updated", () => {});
    cleanup();
    resolveListen?.(unlisten);
    await Promise.resolve();

    expect(unlisten).toHaveBeenCalledTimes(1);
  });
});
