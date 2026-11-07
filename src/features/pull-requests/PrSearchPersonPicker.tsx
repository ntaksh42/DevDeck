import { useEffect, useId, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { searchPullRequestMentions, commandErrorMessage } from "@/lib/azdoCommands";
import { useDebouncedValue } from "@/lib/useDebouncedValue";
import { isImeComposing } from "@/lib/utils";
import type { PrSearchPerson } from "./prSearchHistoryHelpers";

export function PrSearchPersonPicker({ label, organizationId, value, onChange, onUnresolvedChange }: {
  label: string;
  organizationId: string;
  value: PrSearchPerson | null;
  onChange: (person: PrSearchPerson | null) => void;
  onUnresolvedChange: (unresolved: boolean) => void;
}) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(value?.displayName ?? "");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const term = useDebouncedValue(text.trim(), 200);
  const query = useQuery({
    queryKey: ["prSearchPeople", organizationId, term],
    queryFn: () => searchPullRequestMentions({ organizationId, query: term }),
    enabled: open && term.length >= 2 && !!organizationId,
    staleTime: 30_000,
  });
  const candidates = term === text.trim() && !query.isFetching ? (query.data ?? []).slice(0, 8) : [];
  useEffect(() => { if (value) setText(value.displayName); else if (!open) setText(""); }, [value]);
  useEffect(() => { setActiveIndex(0); }, [term]);
  function choose(person: PrSearchPerson | null) {
    onChange(person);
    setText(person?.displayName ?? "");
    onUnresolvedChange(false);
    setOpen(false);
    inputRef.current?.focus();
  }
  return <div className="relative grid gap-1">
    <div className="flex items-center justify-between">
      <label htmlFor={id} className="text-xs font-medium text-muted-foreground">{label}</label>
      <button type="button" onClick={() => choose({ id: "me", displayName: "Me" })} aria-label={`Use me as ${label.toLowerCase()}`} className="text-2xs text-link hover:underline">Me</button>
    </div>
    <div className="flex gap-1">
      <input id={id} ref={inputRef} role="combobox" aria-label={label} aria-controls={`${id}-options`} aria-expanded={open && term.length >= 2}
        aria-activedescendant={open && candidates[activeIndex] ? `${id}-${activeIndex}` : undefined}
        aria-autocomplete="list" autoComplete="off" value={text} placeholder="Anyone"
        className="h-8 min-w-0 flex-1 rounded border border-input bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring"
        onChange={(event) => {
          const next = event.target.value;
          setText(next); onChange(null); onUnresolvedChange(next.trim().length > 0); setOpen(true);
        }}
        onFocus={() => { if (!value) setOpen(true); }}
        onBlur={(event) => { if (!event.currentTarget.parentElement?.parentElement?.contains(event.relatedTarget)) setOpen(false); }}
        onKeyDown={(event) => {
          if (isImeComposing(event.nativeEvent)) return;
          if (event.key === "Escape" && open && term.length >= 2) { event.preventDefault(); event.stopPropagation(); setOpen(false); }
          else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault(); event.stopPropagation(); setOpen(true);
            if (candidates.length) setActiveIndex((index) => (index + (event.key === "ArrowDown" ? 1 : -1) + candidates.length) % candidates.length);
          } else if (event.key === "Enter" && open) {
            event.preventDefault(); event.stopPropagation(); if (candidates[activeIndex]) choose(candidates[activeIndex]);
          }
        }} />
      {text ? <button type="button" aria-label={`Clear ${label.toLowerCase()}`} onClick={() => choose(null)} className="rounded px-1 text-muted-foreground hover:bg-secondary">×</button> : null}
    </div>
    {open && term.length >= 2 ? <div className="absolute left-0 right-0 top-full z-10 mt-1 rounded border border-border bg-card p-1 shadow-lg">
      {query.isError ? <p role="alert" className="p-2 text-xs text-destructive">{commandErrorMessage(query.error)}</p>
        : query.isFetching ? <p className="p-2 text-xs text-muted-foreground">Searching people…</p>
        : candidates.length === 0 ? <p className="p-2 text-xs text-muted-foreground">No matching people.</p> : null}
      <ul id={`${id}-options`} role="listbox" aria-label={`${label} candidates`}>
        {candidates.map((person, index) => <li id={`${id}-${index}`} key={person.id} role="option" aria-selected={activeIndex === index}
          className={`cursor-pointer rounded px-2 py-1 text-xs ${activeIndex === index ? "bg-secondary" : "hover:bg-secondary/60"}`}
          onMouseDown={(event) => event.preventDefault()} onClick={() => choose(person)}>
          <span className="block font-medium">{person.displayName}</span><span className="block truncate text-muted-foreground">{person.uniqueName}</span>
        </li>)}
      </ul>
    </div> : null}
  </div>;
}
