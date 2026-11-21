import { describe, expect, it } from "vitest";
import {
  editableCommentDraft,
  htmlCommentToEditable,
  markdownMentionsToEditable,
  mentionNamesFromHtml,
  stripHardLineBreaks,
} from "./mentionEditDraft";
import {
  activeMentionAt,
  markdownWithHardLineBreaks,
  renderAzureMentionMarkdown,
} from "./workItemMentions";

const GUID = "9ce68702-0694-6ef4-b9fa-0f3143502233";

describe("markdownMentionsToEditable", () => {
  it("shows known @<guid> mentions as @Name and round-trips on save", () => {
    const names = new Map([[GUID, "田中 太郎"]]);
    const draft = markdownMentionsToEditable(`@<${GUID}> please check`, names);
    expect(draft.text).toBe("@田中 太郎 please check");
    expect(draft.mentions).toEqual([{ id: GUID, displayName: "田中 太郎", uniqueName: null }]);
    expect(renderAzureMentionMarkdown(draft.text, draft.mentions)).toBe(`@<${GUID}> please check`);
  });

  it("matches ids case-insensitively and keeps unknown ids", () => {
    const names = new Map([[GUID, "Alice"]]);
    const draft = markdownMentionsToEditable(
      `@<${GUID.toUpperCase()}> and @<00000000-0000-0000-0000-000000000000>`,
      names,
    );
    expect(draft.text).toBe("@Alice and @<00000000-0000-0000-0000-000000000000>");
  });

  it("leaves tokens inside code untouched", () => {
    const names = new Map([[GUID, "Alice"]]);
    const text = `\`@<${GUID}>\`\n\`\`\`\n@<${GUID}>\n\`\`\``;
    expect(markdownMentionsToEditable(text, names)).toEqual({ text, mentions: [] });
  });
});

describe("hard line breaks", () => {
  it("strips the markers added on save so edits do not accumulate them", () => {
    const saved = markdownWithHardLineBreaks("line one\nline two");
    expect(stripHardLineBreaks(saved)).toBe("line one\nline two");
    expect(markdownWithHardLineBreaks(stripHardLineBreaks(saved))).toBe(saved);
  });
});

describe("HTML comments", () => {
  const html =
    `<div><a href="#" data-vss-mention="version:2.0,${GUID}">@Alice Johnson</a> please <b>check</b></div>` +
    `<div>second line<br>third</div><ul><li>one</li><li>two</li></ul>` +
    `<p><img src="https://example/a.png" alt="shot"></p>`;

  it("reads mention names from rendered HTML", () => {
    expect(mentionNamesFromHtml(html).get(GUID)).toBe("Alice Johnson");
  });

  it("converts rich-editor HTML to editable markdown with mentions", () => {
    const draft = htmlCommentToEditable(html);
    expect(draft.text).toBe(
      "@Alice Johnson please **check**\nsecond line\nthird\n- one\n- two\n![shot](https://example/a.png)",
    );
    expect(draft.mentions).toEqual([{ id: GUID, displayName: "Alice Johnson", uniqueName: null }]);
  });

  it("picks the converter from the comment format", () => {
    expect(editableCommentDraft(html, { format: "html" }).text).toContain("@Alice Johnson");
    expect(editableCommentDraft("plain  \ntext", { format: "markdown" }).text).toBe("plain\ntext");
  });
});

describe("activeMentionAt after a finished mention", () => {
  it("does not reopen the search when typing after a one-word mention", () => {
    expect(activeMentionAt("@Bob t", 6, ["Bob"])).toBeNull();
    expect(activeMentionAt("@Bob t", 6)).toEqual({ start: 0, query: "Bob t" });
    expect(activeMentionAt("@Bo", 3, ["Bob"])).toEqual({ start: 0, query: "Bo" });
  });
});
