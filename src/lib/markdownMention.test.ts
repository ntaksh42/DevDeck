import { describe, expect, it } from "vitest";
import { renderMarkdownHtml } from "./markdown";

const ID = "9ce68702-0694-6ef4-b9fa-0f3143502233";

describe("renderMarkdownHtml mentions", () => {
  it("shows the display name when the id is known", () => {
    const html = renderMarkdownHtml(`ping @<${ID}>`, new Map([[ID, "Alice"]]));
    expect(html).toContain("@Alice");
    expect(html).not.toContain(ID);
  });

  it("keeps the literal token when the id is unknown", () => {
    expect(renderMarkdownHtml(`ping @<${ID}>`)).toContain(`@&lt;${ID}&gt;`);
  });
});
