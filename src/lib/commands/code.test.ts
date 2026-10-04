import { beforeEach, describe, expect, it, vi } from "vitest";
import { getRepoFile, newOperationId } from "./code";
import { invokeCommand } from "./runtime";

vi.mock("./runtime", () => ({ invokeCommand: vi.fn() }));

const fileInput = {
  project: "p",
  repository: "r",
  branch: "main",
  path: "/a.txt",
};
const fileResult = {
  path: "/a.txt",
  content: "hi",
  isBinary: false,
  tooLarge: false,
  truncated: false,
  imageDataUrl: null,
};

describe("cancellable commands", () => {
  beforeEach(() => {
    vi.mocked(invokeCommand).mockReset().mockResolvedValue(fileResult);
  });

  it("sends no operationId when no signal is given", async () => {
    await getRepoFile(fileInput);

    expect(invokeCommand).toHaveBeenCalledWith("get_repo_file", { input: fileInput });
  });

  it("cancels the backend operation when the signal aborts mid-flight", async () => {
    let resolveCall: (value: unknown) => void = () => {};
    vi.mocked(invokeCommand).mockImplementation((command) =>
      command === "get_repo_file"
        ? new Promise((resolve) => {
            resolveCall = resolve;
          })
        : Promise.resolve(undefined),
    );
    const controller = new AbortController();

    const pending = getRepoFile(fileInput, controller.signal);
    const sent = vi.mocked(invokeCommand).mock.calls[0][1] as {
      input: { operationId: string };
    };
    expect(sent.input.operationId).toMatch(/^op-/);

    controller.abort();
    expect(invokeCommand).toHaveBeenCalledWith("cancel_operation", {
      operationId: sent.input.operationId,
    });

    resolveCall(fileResult);
    await pending;
  });

  it("does not cancel after the command has finished", async () => {
    const controller = new AbortController();
    await getRepoFile(fileInput, controller.signal);

    controller.abort();

    expect(invokeCommand).not.toHaveBeenCalledWith("cancel_operation", expect.anything());
  });

  it("rejects without calling the backend when already aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(getRepoFile(fileInput, controller.signal)).rejects.toBeDefined();
    expect(invokeCommand).not.toHaveBeenCalled();
  });

  it("generates distinct operation ids", () => {
    expect(newOperationId()).not.toBe(newOperationId());
  });
});
