import { beforeEach, describe, expect, it, vi } from "vitest";
import { invokeCommand } from "./runtime";
import { snoozeItems, type SnoozeItemInput } from "./snooze";

vi.mock("./runtime", () => ({ invokeCommand: vi.fn() }));

describe("snoozeItems", () => {
  beforeEach(() => {
    vi.mocked(invokeCommand).mockReset().mockResolvedValue(undefined);
  });

  it("snoozes every selected item with the same deadline", async () => {
    const inputs: SnoozeItemInput[] = [
      {
        organizationId: "contoso",
        itemType: "work_item",
        itemKey: "456",
        snoozeUntil: "2026-08-17T00:00:00.000Z",
      },
      {
        organizationId: "contoso",
        itemType: "work_item",
        itemKey: "789",
        snoozeUntil: "2026-08-17T00:00:00.000Z",
      },
    ];

    await snoozeItems(inputs);

    expect(invokeCommand).toHaveBeenCalledTimes(2);
    expect(invokeCommand).toHaveBeenNthCalledWith(1, "snooze_item", { input: inputs[0] });
    expect(invokeCommand).toHaveBeenNthCalledWith(2, "snooze_item", { input: inputs[1] });
  });
});
