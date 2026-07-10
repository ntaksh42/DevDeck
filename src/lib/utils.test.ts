import { describe, expect, it, vi } from "vitest";
import { handleSearchInputEscape, markdownLink } from "./utils";

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
