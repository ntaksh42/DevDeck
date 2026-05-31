import { BookOpen, X } from "lucide-react";

export function UserGuideDialog({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={onClose}
      aria-hidden="false"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="user-guide-title"
        className="relative h-[90vh] w-[90vw] max-w-5xl overflow-hidden rounded-lg border border-border bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex h-12 items-center justify-between border-b border-border bg-white px-4">
          <h2 id="user-guide-title" className="flex items-center gap-2 text-sm font-semibold">
            <BookOpen className="h-4 w-4" aria-hidden="true" />
            AzDoDeck User Guide
          </h2>
          <button
            aria-label="Close user guide"
            className="rounded p-1 text-muted-foreground hover:bg-muted"
            onClick={onClose}
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <iframe
          src="./help.html"
          title="AzDoDeck User Guide"
          className="h-[calc(100%-3rem)] w-full border-0"
        />
      </div>
    </div>
  );
}
