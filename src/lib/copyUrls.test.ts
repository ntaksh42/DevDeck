import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { copyRowUrls, urlsToClipboardText } from "./copyUrls";

describe("urlsToClipboardText", () => {
  it("joins URLs with newlines", () => {
    expect(urlsToClipboardText([{ webUrl: "https://a" }, { webUrl: "https://b" }])).toBe(
      "https://a\nhttps://b",
    );
  });

  it("skips rows without a URL", () => {
    expect(
      urlsToClipboardText([{ webUrl: "https://a" }, { webUrl: null }, { webUrl: "" }, {}]),
    ).toBe("https://a");
  });
});

describe("copyRowUrls", () => {
  const writeText = vi.fn(() => Promise.resolve());

  beforeEach(() => {
    vi.useFakeTimers();
    writeText.mockClear();
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reports a singular toast for one URL", async () => {
    const setToast = vi.fn();
    await copyRowUrls([{ webUrl: "https://a" }], setToast);
    expect(writeText).toHaveBeenCalledWith("https://a");
    expect(setToast).toHaveBeenCalledWith("URL copied");
  });

  it("reports the count for multiple URLs", async () => {
    const setToast = vi.fn();
    await copyRowUrls([{ webUrl: "https://a" }, { webUrl: "https://b" }], setToast);
    expect(writeText).toHaveBeenCalledWith("https://a\nhttps://b");
    expect(setToast).toHaveBeenCalledWith("2 URLs copied");
  });

  it("does not touch the clipboard when no row has a URL", async () => {
    const setToast = vi.fn();
    await copyRowUrls([{ webUrl: null }], setToast);
    expect(writeText).not.toHaveBeenCalled();
    expect(setToast).toHaveBeenCalledWith("No URL to copy");
  });

  it("reports a failed clipboard write", async () => {
    writeText.mockRejectedValueOnce(new Error("denied"));
    const setToast = vi.fn();
    await copyRowUrls([{ webUrl: "https://a" }], setToast);
    expect(setToast).toHaveBeenCalledWith("Copy failed");
  });

  it("clears the toast after the timeout", async () => {
    const setToast = vi.fn();
    await copyRowUrls([{ webUrl: "https://a" }], setToast);
    vi.runAllTimers();
    expect(setToast).toHaveBeenLastCalledWith(null);
  });
});
