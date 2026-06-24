/**
 * Shared @mention rendering used by every preview surface (work item comments
 * and Markdown-rendered PR comments / descriptions). Azure DevOps stores
 * mentions as the literal token `@<identity-guid>`. Resolving that token to the
 * person's display name has to happen identically everywhere, otherwise one
 * surface shows "@Alice" while another leaks the raw guid.
 */

// Matches a mention token in either raw (`@<id>`) or HTML-escaped
// (`@&lt;id&gt;`) form. Markdown rendering escapes the angle brackets before we
// substitute, the rich-HTML path may keep them raw, and either side of the
// brackets can be escaped independently, so both encodings are accepted.
const MENTION_TOKEN_PATTERN = /@(?:<|&lt;)([^<>&]+)(?:>|&gt;)/g;

/**
 * Replaces every `@<id>` mention token with a styled span carrying the resolved
 * display name. Runs even when no names are known: an unresolved token must
 * still be neutralized so a downstream sanitizer cannot mistake `<id>` for an
 * unknown HTML tag and silently drop it (which left only a stray "@" in the
 * preview). Apply this BEFORE sanitizing so the injected span is sanitized too.
 */
export function replaceMentionTokensWithDisplayNames(
  value: string | null | undefined,
  mentionDisplayNames: ReadonlyMap<string, string>,
): string | null | undefined {
  if (!value) return value;
  return value.replace(MENTION_TOKEN_PATTERN, (_token, encodedId: string) => {
    const displayName = mentionDisplayNameForId(mentionDisplayNames, encodedId);
    if (displayName) {
      // Mention-styled span so client-side substitutions look the same as
      // mentions resolved by Azure DevOps itself.
      return `<span class="azdo-mention">@${escapeMentionHtml(displayName)}</span>`;
    }
    // No display name available: keep the literal `@<id>` as visible text by
    // escaping the angle brackets, so the id survives sanitization instead of
    // being parsed (and dropped) as markup.
    const rawId = decodeBasicMentionEntities(encodedId);
    return `@&lt;${escapeMentionHtml(rawId)}&gt;`;
  });
}

export function mentionDisplayNameForId(
  mentionDisplayNames: ReadonlyMap<string, string>,
  id: string,
): string | null {
  const normalizedId = decodeBasicMentionEntities(id).trim();
  return (
    mentionDisplayNames.get(normalizedId) ??
    mentionDisplayNames.get(normalizedId.toLowerCase()) ??
    null
  );
}

function decodeBasicMentionEntities(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

function escapeMentionHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
