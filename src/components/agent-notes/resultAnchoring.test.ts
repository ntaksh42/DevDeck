import { describe, expect, it } from "vitest";
import {
  anchorFromRange,
  blockSpanRange,
  buildTextIndex,
  listBlocks,
  locateQuote,
} from "./resultAnchoring";

function parse(html: string): Document {
  return new DOMParser().parseFromString(html, "text/html");
}

describe("resultAnchoring", () => {
  it("round-trips a selection that spans elements", () => {
    const doc = parse("<p>First <b>bold</b> para</p>\n  <p>Second para</p>");
    const index = buildTextIndex(doc);
    const range = doc.createRange();
    range.setStart(doc.querySelector("b")!.firstChild!, 2);
    range.setEnd(doc.querySelectorAll("p")[1].firstChild!, 6);
    const anchor = anchorFromRange(index, range)!;
    expect(anchor.quote).toBe("ld para Second");
    expect(anchor.prefix).toBe("Firstbo");

    const found = locateQuote(doc, index, anchor)!;
    expect(found.toString().replace(/\s+/g, " ")).toBe("ld para Second");
  });

  it("uses context to pick the right repeated occurrence", () => {
    const doc = parse("<p>alpha retry beta</p><p>gamma retry delta</p>");
    const index = buildTextIndex(doc);
    const found = locateQuote(doc, index, { quote: "retry", prefix: "gamma" })!;
    expect(found.startContainer.parentElement?.textContent).toBe("gamma retry delta");
  });

  it("still finds the quote after the HTML is reflowed", () => {
    const doc = parse("<ul>\n  <li>\n    Set a 1.5 s\n    deadline\n  </li>\n</ul>");
    const found = locateQuote(doc, buildTextIndex(doc), { quote: "Set a 1.5 s deadline" });
    expect(found).not.toBeNull();
  });

  it("returns null when the quote is gone", () => {
    const doc = parse("<p>retries are capped at five</p>");
    expect(locateQuote(doc, buildTextIndex(doc), { quote: "capped at 3" })).toBeNull();
  });

  it("ignores script and style text", () => {
    const doc = parse("<style>p{}</style><p>visible</p><script>var hidden</script>");
    expect(buildTextIndex(doc).text).toBe("visible");
  });

  it("lists leaf blocks and spans them", () => {
    const doc = parse("<h2>Cause</h2><ul><li><p>one</p></li><li>two</li></ul><table><tr><td>a</td><td>b</td></tr></table>");
    const blocks = listBlocks(doc);
    expect(blocks.map((b) => b.tagName)).toEqual(["H2", "P", "LI", "TR"]);
    expect(blockSpanRange(doc, blocks, 2, 1).toString()).toBe("onetwo");
  });
});
