import type { InboxLink } from "./inboxPresentation";
import { INBOX_LINK_ORIGINS } from "./inboxLinks";
import { Kbd } from "./InboxPreviewPanels";

const KIND_BADGE = { workItem: "WI", pullRequest: "PR", external: "URL" } as const;

function LinkChip({ link, number, onOpen }: { link: InboxLink; number: number; onOpen: (link: InboxLink) => void }) {
  const tooltip = [
    link.kind === "external" ? link.url : link.label,
    link.title,
    link.detail,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <button
      type="button"
      onClick={() => onOpen(link)}
      title={tooltip}
      className="inline-flex min-w-0 max-w-[22rem] items-center gap-1 rounded text-link hover:underline focus:outline-none focus:ring-2 focus:ring-ring"
    >
      {number <= 9 ? <Kbd>{String(number)}</Kbd> : null}
      <span className="text-[10px] font-semibold text-muted-foreground">{KIND_BADGE[link.kind]}</span>
      <span className="shrink-0">{link.label}</span>
      {link.title ? <span className="min-w-0 truncate text-foreground">{link.title}</span> : null}
      {link.detail ? <span className="shrink-0 text-[11px] text-muted-foreground">({link.detail})</span> : null}
      {link.kind === "external" ? <span aria-hidden="true">↗</span> : null}
    </button>
  );
}

/**
 * Every link around the item in one place, above the conversation, so an
 * answer needs no scrolling past the thread (and the pinned reply box) to find
 * the work item, PR or page the comment is about. `links` is already ordered by
 * origin; the first nine are opened with `1`-`9` from the list, all of them
 * with Tab and Enter.
 */
export function InboxRelatedLinks({ links, onOpen }: { links: InboxLink[]; onOpen: (link: InboxLink) => void }) {
  if (links.length === 0) return null;
  return (
    <section aria-label="Related links" data-inbox-links="true" className="mt-1.5 space-y-0.5 text-xs">
      {INBOX_LINK_ORIGINS.map(({ origin, label }) => {
        const group = links.map((link, index) => ({ link, number: index + 1 })).filter(({ link }) => link.origin === origin);
        if (group.length === 0) return null;
        return (
          <div key={origin} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
            <span className="w-[5.5rem] shrink-0 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {label}
            </span>
            {group.map(({ link, number }) => (
              <LinkChip
                key={link.kind === "external" ? link.url : `${link.kind}-${link.id}`}
                link={link}
                number={number}
                onOpen={onOpen}
              />
            ))}
          </div>
        );
      })}
    </section>
  );
}
