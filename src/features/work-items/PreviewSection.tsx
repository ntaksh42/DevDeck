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
    <div className="flex min-w-0 items-center gap-1.5">
      <span className="shrink-0 text-[10px] font-semibold uppercase leading-4 text-muted-foreground">
        {label}
      </span>
      <div className="flex min-w-0 flex-1 items-center leading-4">{children}</div>
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
      className={`flex min-w-0 items-baseline gap-1.5 ${
        wide ? "sm:col-span-2 2xl:col-span-3" : ""
      }`}
    >
      <dt className="shrink-0 text-[10px] font-semibold uppercase leading-4 text-muted-foreground">
        {label}
      </dt>
      <dd
        className={`min-w-0 flex-1 text-[12px] font-semibold leading-4 text-foreground ${
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
  children,
  className = "",
  collapseId,
  title,
}: {
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
            className="flex w-full items-center gap-1 rounded bg-slate-200 px-1.5 py-1 text-left hover:bg-slate-300 focus:outline-none focus:ring-1 focus:ring-ring dark:bg-muted dark:hover:bg-muted/80"
          >
            <ChevronRight
              className={`h-3 w-3 shrink-0 text-muted-foreground transition-transform ${
                collapsed ? "" : "rotate-90"
              }`}
              aria-hidden="true"
            />
            <h3 className="text-[10px] font-semibold uppercase tracking-wide leading-4 text-muted-foreground">
              {title}
            </h3>
          </button>
        ) : (
          <h3 className="rounded bg-slate-200 px-1.5 py-1 text-[10px] font-semibold uppercase tracking-wide leading-4 text-muted-foreground dark:bg-muted">
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
    <div className="flex min-w-0 items-baseline gap-1.5 sm:col-span-2 2xl:col-span-3">
      <dt className="shrink-0 text-[10px] font-semibold uppercase leading-4 text-muted-foreground">
        {label}
      </dt>
      <dd className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
        {tags.length === 0 && !onChange ? (
          <span className="text-[12px] font-semibold leading-4 text-foreground">—</span>
        ) : (
          tags.map((tag) => (
            <span
              key={tag}
              className="inline-flex max-w-full items-center gap-0.5 truncate rounded-sm border border-border bg-secondary px-1 text-[10px] font-medium leading-4 text-secondary-foreground"
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
