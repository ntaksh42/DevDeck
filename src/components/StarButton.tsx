import { Star } from "lucide-react";

// Small toggle shown at the head of a grid row to star/unstar the item. Lives
// inside the row so it must stop click/keyboard events from reaching the row's
// own selection and navigation handlers.
export function StarButton({
  starred,
  onToggle,
  label,
}: {
  starred: boolean;
  onToggle: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={starred}
      aria-label={starred ? `Unstar ${label}` : `Star ${label}`}
      title={starred ? "Unstar (*)" : "Star (*)"}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          e.stopPropagation();
          onToggle();
        }
      }}
      className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-secondary focus:outline-none focus:ring-1 focus:ring-ring"
    >
      <Star
        className={`h-3.5 w-3.5 ${starred ? "fill-amber-400 text-amber-400" : ""}`}
        aria-hidden="true"
      />
    </button>
  );
}
