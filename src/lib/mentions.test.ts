import { describe, expect, it } from "vitest";
import { replaceMentionTokensWithDisplayNames } from "./mentions";

describe("replaceMentionTokensWithDisplayNames", () => {
  const names = new Map([
    ["11111111-1111-4111-8111-111111111111", "Alice Example"],
  ]);

  it("resolves raw @<id> tokens to a mention span", () => {
    const html = replaceMentionTokensWithDisplayNames(
      "<p>Hi @<11111111-1111-4111-8111-111111111111></p>",
      names,
    );
    expect(html).toBe('<p>Hi <span class="azdo-mention">@Alice Example</span></p>');
  });

  it("resolves HTML-escaped @&lt;id&gt; tokens the same way", () => {
    const html = replaceMentionTokensWithDisplayNames(
      "<p>Hi @&lt;11111111-1111-4111-8111-111111111111&gt;</p>",
      names,
    );
    expect(html).toContain('<span class="azdo-mention">@Alice Example</span>');
  });

  it("is case-insensitive on the id", () => {
    const html = replaceMentionTokensWithDisplayNames(
      "@<11111111-1111-4111-8111-111111111111>".toUpperCase(),
      names,
    );
    expect(html).toContain("@Alice Example");
  });

  it("keeps an unknown id visible as an escaped literal token", () => {
    const html = replaceMentionTokensWithDisplayNames("@<unknown-id>", new Map());
    expect(html).toBe("@&lt;unknown-id&gt;");
  });

  it("escapes a malicious display name so it cannot inject markup", () => {
    const evil = new Map([["abc", '<img src=x onerror=alert(1)>']]);
    const html = replaceMentionTokensWithDisplayNames("@<abc>", evil);
    expect(html).toBe(
      '<span class="azdo-mention">@&lt;img src=x onerror=alert(1)&gt;</span>',
    );
    expect(html).not.toContain("<img");
  });
});
