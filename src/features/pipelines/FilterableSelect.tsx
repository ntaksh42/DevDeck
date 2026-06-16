import {
  type FocusEvent as ReactFocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ChevronDown } from "lucide-react";

export type SelectOption = { value: string; label: string };

// A select that also accepts free typing to narrow the option list. Used for
// the Project and Pipeline pickers, which can grow long.
export function FilterableSelect({
  value,
  options,
  onChange,
  disabled,
  placeholder,
  ariaLabel,
}: {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  ariaLabel: string;
}) {
  const [open, setOpen] = useState(false);
  // The typed filter text. Empty while the list is open but untouched, so the
  // full option list shows; the selected label is surfaced via the input
  // placeholder rather than by seeding `query` (which would filter the list).
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const selectedLabel = options.find((option) => option.value === value)?.label ?? "";

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return options;
    return options.filter((option) => option.label.toLowerCase().includes(needle));
  }, [options, query]);

  // Reset the active option to the top whenever the filtered set changes, so a
  // new query never leaves the highlight on an unrelated option.
  useEffect(() => {
    setActiveIndex(0);
  }, [filtered]);

  // Close when a click lands outside the widget.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  function openList() {
    if (disabled || open) return;
    setQuery("");
    // Highlight the currently selected option so it is the default Enter target.
    setActiveIndex(Math.max(options.findIndex((option) => option.value === value), 0));
    setOpen(true);
  }

  function commit(option: SelectOption) {
    onChange(option.value);
    setOpen(false);
    setQuery("");
  }

  function handleKeyDown(event: ReactKeyboardEvent) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!open) openList();
      else setActiveIndex((index) => Math.min(index + 1, filtered.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (open) setActiveIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter") {
      if (open && filtered[activeIndex]) {
        event.preventDefault();
        commit(filtered[activeIndex]);
      }
    } else if (event.key === "Escape") {
      if (open) {
        // Stop the keydown from bubbling to dialogs/global handlers, but keep
        // focus on the input so the user can reopen or keep typing.
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        setQuery("");
      }
    }
  }

  // Close when focus leaves the widget entirely (e.g. Tab away).
  function handleBlur(event: ReactFocusEvent<HTMLDivElement>) {
    const next = event.relatedTarget as Node | null;
    if (next && containerRef.current?.contains(next)) return;
    setOpen(false);
    setQuery("");
  }

  return (
    <div ref={containerRef} className="relative" onBlur={handleBlur}>
      <div className="relative">
        <input
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-label={ariaLabel}
          disabled={disabled}
          value={open ? query : selectedLabel}
          placeholder={open && selectedLabel ? selectedLabel : placeholder}
          onMouseDown={() => {
            // Toggle on click so a second click closes the list.
            if (open) setOpen(false);
            else openList();
          }}
          onChange={(event) => {
            setQuery(event.target.value);
            if (!open) setOpen(true);
          }}
          onKeyDown={handleKeyDown}
          className="h-9 w-full rounded-md border border-input bg-background pl-3 pr-8 text-sm outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
        />
        <ChevronDown
          className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
      </div>
      {open ? (
        <ul
          role="listbox"
          aria-label={ariaLabel}
          className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-border bg-popover py-1 shadow-md"
        >
          {filtered.length === 0 ? (
            <li className="px-3 py-1.5 text-sm text-muted-foreground">No matches</li>
          ) : (
            filtered.map((option, index) => (
              <li
                key={option.value}
                role="option"
                aria-selected={option.value === value}
                onMouseEnter={() => setActiveIndex(index)}
                onPointerDown={(event) => {
                  // Prevent the input from losing focus before we commit.
                  event.preventDefault();
                  commit(option);
                }}
                className={`cursor-pointer px-3 py-1.5 text-sm ${
                  index === activeIndex ? "bg-accent text-accent-foreground" : ""
                } ${option.value === value ? "font-medium" : ""}`}
              >
                {option.label}
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
