import { type ReactNode, useState } from "react";
import { ChevronRight, Loader2, X } from "lucide-react";
import { readStoredJson, writeStoredJson } from "@/lib/storage";
import { ShortcutHint } from "@/components/ShortcutHint";
import { splitWorkItemTags } from "./workItemChanges";
import { stopPreviewNavigationKeyDown } from "./workItemPreviewHelpers";

const WI_PREVIEW_COLLAPSED_SECTIONS_STORAGE_KEY =
  "azdodeck:view:wiPreviewCollapsedSections:v1";

function loadCollapsedPreviewSections(): Set<string> {
  return readStoredJson(
    WI_PREVIEW_COLLAPSED_SECTIONS_STORAGE_KEY,
    (raw) =>
      Array.isArray(raw)
        ? new Set(raw.filter((value): value is string => typeof value === "string"))
        : undefined,
    new Set(),
  );
}

function storeCollapsedPreviewSections(collapsed: Set<string>) {
  writeStoredJson(WI_PREVIEW_COLLAPSED_SECTIONS_STORAGE_KEY, [...collapsed]);
}

export function PreviewControl({
  children,
  label,
  shortcut,
}: {
  children: ReactNode;
  label: string;
  shortcut?: string;
}) {
  return (
    <div className="inline-flex max-w-full min-w-0 items-center gap-1 rounded-full border border-border bg-card py-0.5 pl-1.5 pr-1">
      <span className="shrink-0 text-[9px] font-extrabold uppercase tracking-wide leading-4 text-slate-500 dark:text-slate-400">
        {label}
      </span>
      <div className="flex min-w-0 items-center leading-4">{children}</div>
      {shortcut ? <ShortcutHint>{shortcut}</ShortcutHint> : null}
    </div>
  );
}

export function PreviewField({
  label,
  value,
  wide = false,
}: {
  label: string;
  value: string;
  wide?: boolean;
}) {
  return (
    <div
      className={`inline-flex max-w-full items-baseline gap-1 rounded-full border border-border bg-card py-0.5 pl-1.5 pr-2 ${
        wide ? "w-full" : "min-w-0"
      }`}
    >
      <dt className="shrink-0 text-[9px] font-extrabold uppercase tracking-wide leading-4 text-slate-500 dark:text-slate-400">
        {label}
      </dt>
      <dd
        className={`min-w-0 text-[11px] font-bold leading-4 text-foreground ${
          wide ? "break-words" : "truncate"
        }`}
        title={value}
      >
        {value}
      </dd>
    </div>
  );
}

export function PreviewSection({
  accentColor = "border-l-slate-400 dark:border-l-slate-500",
  children,
  className = "",
  collapseId,
  title,
}: {
  /** Tailwind `border-l-*` class(es) used for the band's left accent stripe,
      so each section reads as its own kind at a glance while scrolling. */
  accentColor?: string;
  children: ReactNode;
  className?: string;
  collapseId?: string;
  title: string;
}) {
  const [collapsed, setCollapsed] = useState(() =>
    collapseId ? loadCollapsedPreviewSections().has(collapseId) : false,
  );

  function toggleCollapsed() {
    if (!collapseId) return;
    setCollapsed((current) => {
      const next = !current;
      const stored = loadCollapsedPreviewSections();
      if (next) stored.add(collapseId);
      else stored.delete(collapseId);
      storeCollapsedPreviewSections(stored);
      return next;
    });
  }

  return (
    <section className={`min-w-0 ${className}`}>
      {/* Muted band so each section reads as a distinct group and the
          Description ↔ Comments boundary is obvious; collapse stays. */}
      <div className="sticky top-0 z-10 mb-1 bg-card/95 pt-1 backdrop-blur-sm">
        {collapseId ? (
          <button
            type="button"
            aria-expanded={!collapsed}
            onClick={toggleCollapsed}
            className={`flex w-full items-center gap-1 rounded border-l-4 bg-slate-200 px-1.5 py-1 text-left hover:bg-slate-300 focus:outline-none focus:ring-1 focus:ring-ring dark:bg-slate-700 dark:hover:bg-slate-600 ${accentColor}`}
          >
            <ChevronRight
              className={`h-3 w-3 shrink-0 text-slate-600 transition-transform dark:text-slate-300 ${
                collapsed ? "" : "rotate-90"
              }`}
              aria-hidden="true"
            />
            <h3 className="text-[10px] font-extrabold uppercase tracking-wider leading-4 text-slate-800 dark:text-slate-100">
              {title}
            </h3>
          </button>
        ) : (
          <h3
            className={`rounded border-l-4 bg-slate-200 px-1.5 py-1 text-[10px] font-extrabold uppercase tracking-wider leading-4 text-slate-800 dark:bg-slate-700 dark:text-slate-100 ${accentColor}`}
          >
            {title}
          </h3>
        )}
      </div>
      {collapsed ? null : children}
    </section>
  );
}

export function PreviewTagsField({
  label,
  value,
  pending = false,
  onChange,
}: {
  label: string;
  value: string | null;
  pending?: boolean;
  onChange?: (tags: string[]) => void;
}) {
  const tags = splitWorkItemTags(value);
  const [draft, setDraft] = useState("");

  function addDraftTag() {
    const tag = draft.trim();
    if (!tag || !onChange) return;
    setDraft("");
    if (tags.some((existing) => existing.toLowerCase() === tag.toLowerCase())) return;
    onChange([...tags, tag]);
  }

  return (
    <div className="flex w-full min-w-0 items-baseline gap-1.5">
      <dt className="shrink-0 text-[9px] font-extrabold uppercase tracking-wide leading-4 text-slate-500 dark:text-slate-400">
        {label}
      </dt>
      <dd className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
        {tags.length === 0 && !onChange ? (
          <span className="text-[11px] font-bold leading-4 text-foreground">—</span>
        ) : (
          tags.map((tag) => (
            <span
              key={tag}
              className="inline-flex max-w-full items-center gap-0.5 truncate rounded-full border border-border bg-secondary px-2 py-px text-[10px] font-semibold leading-4 text-secondary-foreground"
              title={tag}
            >
              {tag}
              {onChange ? (
                <button
                  type="button"
                  aria-label={`Remove tag ${tag}`}
                  disabled={pending}
                  onClick={() => onChange(tags.filter((existing) => existing !== tag))}
                  className="rounded text-muted-foreground hover:text-foreground disabled:opacity-50"
                >
                  <X className="h-2.5 w-2.5" aria-hidden="true" />
                </button>
              ) : null}
            </span>
          ))
        )}
        {onChange ? (
          <input
            value={draft}
            disabled={pending}
            placeholder="+ tag"
            aria-label="Add tag"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              stopPreviewNavigationKeyDown(event);
              if (event.key === "Enter") {
                event.preventDefault();
                addDraftTag();
              }
            }}
            onBlur={addDraftTag}
            className="w-16 min-w-0 rounded-sm border border-transparent bg-transparent px-1 text-[10px] leading-4 outline-none placeholder:text-muted-foreground/60 focus:border-input focus:bg-background disabled:opacity-50"
          />
        ) : null}
        {pending ? (
          <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" aria-hidden="true" />
        ) : null}
      </dd>
    </div>
  );
}
