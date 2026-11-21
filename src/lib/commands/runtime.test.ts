import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "@/lib/runtime";
import { demoInvoke } from "@/lib/azdoDemo";
import { invokeCommand } from "./runtime";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@/lib/runtime", () => ({ isTauriRuntime: vi.fn() }));
vi.mock("@/lib/azdoDemo", () => ({ demoInvoke: vi.fn() }));

describe("work item query IPC deadline", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(isTauriRuntime).mockReturnValue(true);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.resetAllMocks();
  });

  it.each(["run_work_item_query", "count_work_item_query", "list_work_item_projects"])(
    "unblocks a hung %s and allows another request",
    async (command) => {
      let resolveLate!: (value: unknown) => void;
      vi.mocked(invoke).mockImplementationOnce(() => new Promise((resolve) => {
        resolveLate = resolve;
      }));
      const request = invokeCommand(command, { input: {} });
      const rejected = expect(request).rejects.toThrow("timed out");
      await vi.advanceTimersByTimeAsync(125_000);
      await rejected;
      vi.mocked(invoke).mockResolvedValueOnce([42]);
      expect(await invokeCommand(command)).toEqual([42]);
      resolveLate([1]);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("clears the timer on success and backend error", async () => {
    vi.mocked(invoke).mockResolvedValueOnce([]);
    expect(await invokeCommand("run_work_item_query")).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
    const error = { message: "invalid WIQL" };
    vi.mocked(invoke).mockRejectedValueOnce(error);
    await expect(invokeCommand("run_work_item_query")).rejects.toEqual(error);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not time out writes", async () => {
    vi.mocked(invoke).mockReturnValueOnce(new Promise(() => {}));
    void invokeCommand("update_work_item_fields");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("preserves browser demo results", async () => {
    vi.mocked(isTauriRuntime).mockReturnValue(false);
    vi.mocked(demoInvoke).mockResolvedValueOnce([]);
    expect(await invokeCommand("run_work_item_query", { input: {} })).toEqual([]);
    expect(invoke).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
