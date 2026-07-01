import { describe, expect, it } from "vitest";
import { markdownLink } from "./utils";

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
