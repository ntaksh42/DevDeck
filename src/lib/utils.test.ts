import { describe, expect, it, vi } from "vitest";
import {
  formatRelativeDate,
  handleSearchInputEscape,
  isImeComposing,
  markdownLink,
} from "./utils";

describe("markdownLink", () => {
  it("wraps the text and url in Markdown link syntax", () => {
    expect(markdownLink("!123 Fix the thing", "https://dev.azure.com/contoso/_git/repo/pullrequest/123")).toBe(
      "[!123 Fix the thing](https://dev.azure.com/contoso/_git/repo/pullrequest/123)",
    );
  });

  it("strips brackets from the text so the link syntax cannot break", () => {
    expect(markdownLink("Fix [urgent] bug", "https://example.com")).toBe(
      "[Fix urgent bug](https://example.com)",
    );
  });
});

describe("formatRelativeDate", () => {
  it("formats past timestamps by elapsed time", () => {
    const now = Date.now();
    expect(formatRelativeDate(new Date(now - 5 * 60_000).toISOString())).toBe("5m ago");
    expect(formatRelativeDate(new Date(now - 3 * 3_600_000).toISOString())).toBe("3h ago");
    expect(formatRelativeDate(new Date(now - 2 * 86_400_000).toISOString())).toBe("2d ago");
  });

  it("does not report a future timestamp as an elapsed duration", () => {
    // Clock skew between the service and this machine can hand us a timestamp
    // ahead of `Date.now()`. A negative difference must not fall through the
    // minute/hour/day branches, which would render a negative age.
    const future = new Date(Date.now() + 3 * 3_600_000).toISOString();
    expect(formatRelativeDate(future)).toBe("just now");
  });

  it("returns a placeholder for an unparseable value", () => {
    expect(formatRelativeDate("not-a-date")).toBe("—");
  });
});

describe("handleSearchInputEscape", () => {
  it("clears the filter and blurs the input when onClear is provided", () => {
    const input = document.createElement("input");
    input.blur = vi.fn();
    const onClear = vi.fn();
    const preventDefault = vi.fn();
    const event = { key: "Escape", preventDefault, currentTarget: input } as any;

    handleSearchInputEscape(event, onClear);

    expect(preventDefault).toHaveBeenCalled();
    expect(onClear).toHaveBeenCalled();
    expect(input.blur).toHaveBeenCalled();
  });

  it("blurs the input without clearing when onClear is omitted", () => {
    const input = document.createElement("input");
    input.blur = vi.fn();
    const preventDefault = vi.fn();
    const event = { key: "Escape", preventDefault, currentTarget: input } as any;

    handleSearchInputEscape(event);

    expect(preventDefault).toHaveBeenCalled();
    expect(input.blur).toHaveBeenCalled();
  });

  it("does nothing for keys other than Escape", () => {
    const input = document.createElement("input");
    input.blur = vi.fn();
    const onClear = vi.fn();
    const preventDefault = vi.fn();
    const event = { key: "Enter", preventDefault, currentTarget: input } as any;

    handleSearchInputEscape(event, onClear);

    expect(preventDefault).not.toHaveBeenCalled();
    expect(onClear).not.toHaveBeenCalled();
    expect(input.blur).not.toHaveBeenCalled();
  });
});

describe("stored numbers with unavailable storage", () => {
  it("fall back instead of throwing when localStorage access throws", async () => {
    const { vi } = await import("vitest");
    const { storedNumber, storedNumbers } = await import("./utils");
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    try {
      expect(storedNumber("k", 7, 0, 10)).toBe(7);
      expect(storedNumbers("k", [1, 2], [0, 0], [5, 5])).toEqual([1, 2]);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("isImeComposing", () => {
  it("is true while composing, whether the flag is on a native or React event", () => {
    expect(isImeComposing({ key: "Enter", isComposing: true })).toBe(true);
    expect(isImeComposing({ key: "Enter", nativeEvent: { isComposing: true } })).toBe(true);
  });

  it("treats Chromium's Process key as composing", () => {
    expect(isImeComposing({ key: "Process" })).toBe(true);
  });

  it("is false for ordinary key presses", () => {
    expect(isImeComposing({ key: "Enter" })).toBe(false);
    expect(isImeComposing({ key: "Enter", isComposing: false })).toBe(false);
    expect(isImeComposing({ key: "Escape", nativeEvent: { isComposing: false } })).toBe(false);
  });
});
