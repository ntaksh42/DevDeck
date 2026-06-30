import hljs from "highlight.js/lib/common";
import DOMPurify from "dompurify";

// Maps file extensions to highlight.js language names. Anything not listed
// falls back to auto-detection.
const EXTENSION_LANGUAGE: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  rs: "rust",
  py: "python",
  rb: "ruby",
  go: "go",
  java: "java",
  kt: "kotlin",
  cs: "csharp",
  cpp: "cpp",
  cc: "cpp",
  c: "c",
  h: "cpp",
  hpp: "cpp",
  php: "php",
  swift: "swift",
  scala: "scala",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  ps1: "powershell",
  sql: "sql",
  json: "json",
  yml: "yaml",
  yaml: "yaml",
  toml: "ini",
  ini: "ini",
  xml: "xml",
  html: "xml",
  css: "css",
  scss: "scss",
  less: "less",
  md: "markdown",
  markdown: "markdown",
  dockerfile: "dockerfile",
};

function languageForFile(fileName: string): string | undefined {
  const lower = fileName.toLowerCase();
  if (lower === "dockerfile") return "dockerfile";
  const ext = lower.includes(".") ? lower.slice(lower.lastIndexOf(".") + 1) : "";
  const mapped = EXTENSION_LANGUAGE[ext];
  // Only return a language highlight.js actually knows; otherwise auto-detect.
  return mapped && hljs.getLanguage(mapped) ? mapped : undefined;
}

export type HighlightedCode = {
  /** Sanitized HTML for the whole file (highlight.js spans). */
  html: string;
  /** The resolved language name, for display. */
  language: string | null;
};

// Highlights a file's content, returning sanitized HTML. Uses the extension to
// pick a grammar, falling back to auto-detection for unknown types.
export function highlightCode(content: string, fileName: string): HighlightedCode {
  const language = languageForFile(fileName);
  try {
    const result = language
      ? hljs.highlight(content, { language, ignoreIllegals: true })
      : hljs.highlightAuto(content);
    return {
      html: DOMPurify.sanitize(result.value, { USE_PROFILES: { html: true } }),
      language: result.language ?? language ?? null,
    };
  } catch {
    // Highlighting should never break rendering; fall back to escaped text.
    return { html: DOMPurify.sanitize(escapeHtml(content)), language: null };
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Highlights a file's content and splits the result back into one sanitized
 * HTML string per line, for renderers that lay out lines individually (e.g. a
 * diff view). `highlightCode` only returns one HTML blob for the whole file,
 * and a token (e.g. a block comment or string) can span multiple lines, so
 * splitting on `\n` naively would leave unbalanced `<span>` tags. This closes
 * open spans at each line break and reopens them at the start of the next
 * line, the standard technique for per-line syntax highlighting.
 */
export function highlightLines(content: string, fileName: string): string[] {
  const { html } = highlightCode(content, fileName);
  const lines: string[] = [];
  const openTags: string[] = [];
  let current = "";
  let i = 0;
  while (i < html.length) {
    if (html.startsWith("<span", i)) {
      const end = html.indexOf(">", i);
      if (end === -1) break;
      const tag = html.slice(i, end + 1);
      openTags.push(tag);
      current += tag;
      i = end + 1;
    } else if (html.startsWith("</span>", i)) {
      openTags.pop();
      current += "</span>";
      i += "</span>".length;
    } else if (html[i] === "\n") {
      current += "</span>".repeat(openTags.length);
      lines.push(current);
      current = openTags.join("");
      i += 1;
    } else {
      const next = nextHtmlBoundary(html, i);
      current += html.slice(i, next);
      i = next;
    }
  }
  lines.push(current);
  return lines;
}

/** Index of the next `<span`, `</span>`, or `\n` at or after `from`. */
function nextHtmlBoundary(html: string, from: number): number {
  const candidates = [
    html.indexOf("<span", from),
    html.indexOf("</span>", from),
    html.indexOf("\n", from),
  ].filter((index) => index !== -1);
  return candidates.length > 0 ? Math.min(...candidates) : html.length;
}
