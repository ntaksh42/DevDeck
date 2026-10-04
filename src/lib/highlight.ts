import hljs from "highlight.js/lib/common";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import powershell from "highlight.js/lib/languages/powershell";
import scala from "highlight.js/lib/languages/scala";
import DOMPurify from "dompurify";

// `highlight.js/lib/common` does not register these, even though file
// extensions below claim them; register them explicitly so highlighting
// actually uses the named grammar instead of silently auto-detecting.
hljs.registerLanguage("dockerfile", dockerfile);
hljs.registerLanguage("powershell", powershell);
hljs.registerLanguage("scala", scala);

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
  lua: "lua",
  pl: "perl",
  pm: "perl",
  r: "r",
  vb: "vbnet",
  graphql: "graphql",
  gql: "graphql",
  diff: "diff",
  patch: "diff",
};

function languageForFile(fileName: string): string | undefined {
  const lower = fileName.toLowerCase();
  if (lower === "dockerfile") return "dockerfile";
  if (lower === "makefile") return "makefile";
  const ext = lower.includes(".") ? lower.slice(lower.lastIndexOf(".") + 1) : "";
  const mapped = EXTENSION_LANGUAGE[ext];
  // Only return a language highlight.js actually knows; otherwise auto-detect.
  return mapped && hljs.getLanguage(mapped) ? mapped : undefined;
}

// highlightAuto tries every registered grammar and is far slower than a
// known-language pass, so it gets a much lower size cap. Above the caps the
// content is shown as escaped plain text to keep the UI responsive.
const MAX_AUTO_DETECT_CHARS = 100_000;
const MAX_HIGHLIGHT_CHARS = 300_000;

export type HighlightedCode = {
  /** Sanitized HTML for the whole file (highlight.js spans). */
  html: string;
  /** The resolved language name, for display. */
  language: string | null;
  /** True when the file was too large to highlight and is shown as plain text. */
  skipped: boolean;
};

// Highlights a file's content, returning sanitized HTML. Uses the extension to
// pick a grammar, falling back to auto-detection for unknown types.
export function highlightCode(content: string, fileName: string): HighlightedCode {
  const language = languageForFile(fileName);
  const maxChars = language ? MAX_HIGHLIGHT_CHARS : MAX_AUTO_DETECT_CHARS;
  if (content.length > maxChars) {
    return { html: DOMPurify.sanitize(escapeHtml(content)), language: null, skipped: true };
  }
  try {
    const result = language
      ? hljs.highlight(content, { language, ignoreIllegals: true })
      : hljs.highlightAuto(content);
    return {
      html: DOMPurify.sanitize(result.value, { USE_PROFILES: { html: true } }),
      language: result.language ?? language ?? null,
      skipped: false,
    };
  } catch {
    // Highlighting should never break rendering; fall back to escaped text.
    return { html: DOMPurify.sanitize(escapeHtml(content)), language: null, skipped: false };
  }
}

// Highlights a single source line by the file's extension. Unlike
// `highlightCode` it never auto-detects (a lone line is too little to guess
// from), so it returns null for unknown file types; diff views then show the
// line as plain text. Lines are highlighted independently, so a token that
// spans lines (e.g. a block comment) is only coloured on the line that opens it.
const lineHtmlCache = new Map<string, string>();
const MAX_LINE_CACHE = 5000;
const MAX_LINE_CHARS = 2000;

export function highlightLineHtml(text: string, fileName: string): string | null {
  const language = languageForFile(fileName);
  if (!language || text.length === 0 || text.length > MAX_LINE_CHARS) return null;
  const key = `${language}:${text}`;
  const cached = lineHtmlCache.get(key);
  if (cached !== undefined) return cached;
  try {
    const html = DOMPurify.sanitize(hljs.highlight(text, { language, ignoreIllegals: true }).value, {
      USE_PROFILES: { html: true },
    });
    if (lineHtmlCache.size >= MAX_LINE_CACHE) lineHtmlCache.clear();
    lineHtmlCache.set(key, html);
    return html;
  } catch {
    return null;
  }
}

// Splits highlight.js HTML into one HTML string per source line. A span that
// is still open at a line break (e.g. a multi-line comment) is closed there and
// reopened on the next line, so every line is well-formed on its own.
export function splitHighlightedLines(html: string): string[] {
  const lines: string[] = [];
  const open: string[] = [];
  let current = "";
  for (const token of html.split(/(<span[^>]*>|<\/span>|\n)/)) {
    if (token === "\n") {
      lines.push(current + "</span>".repeat(open.length));
      current = open.join("");
    } else {
      if (token.startsWith("<span")) open.push(token);
      else if (token === "</span>") open.pop();
      current += token;
    }
  }
  lines.push(current + "</span>".repeat(open.length));
  return lines;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
