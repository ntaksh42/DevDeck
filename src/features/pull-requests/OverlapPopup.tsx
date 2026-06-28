import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

type OverlapPopupProps = {
  anchorEl: HTMLButtonElement | null;
  overlaps: { path: string; prKeys: string[] }[];
  prKeyToLabel: Map<string, string>;
  onClose: () => void;
};

export function OverlapPopup({
  anchorEl,
  overlaps,
  prKeyToLabel,
  onClose,
}: OverlapPopupProps) {
  const popupRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    popupRef.current?.focus();
  }, []);

  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (popupRef.current?.contains(e.target as Node)) return;
      if (anchorEl?.contains(e.target as Node)) return;
      onClose();
    }
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [anchorEl, onClose]);

  const anchorRect = anchorEl?.getBoundingClientRect();
  const left = anchorRect
    ? Math.max(8, Math.min(anchorRect.left, window.innerWidth - 360))
    : 8;
  const top = anchorRect ? Math.max(8, anchorRect.top - 8) : 8;

  return (
    <div
      ref={popupRef}
      role="dialog"
      aria-label="Overlapping changed files"
      tabIndex={-1}
      className="fixed z-50 w-[352px] -translate-y-full rounded-md border border-border bg-popover shadow-lg outline-none"
      style={{ left, top }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') {
          e.preventDefault();
          onClose();
        }
      }}
    >
      <div className="flex items-center justify-between border-b border-border px-3 py-2 text-xs font-semibold text-foreground">
        <span>Overlapping files ({overlaps.length})</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="rounded text-muted-foreground hover:text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <ul className="max-h-72 overflow-auto p-2 text-xs">
        {overlaps.map((overlap) => (
          <li
            key={overlap.path}
            className="border-b border-border/60 px-1 py-1.5 last:border-b-0"
          >
            <div className="break-all font-mono text-foreground" title={overlap.path}>
              {overlap.path}
            </div>
            <div className="mt-0.5 text-muted-foreground">
              {overlap.prKeys.map((key) => prKeyToLabel.get(key) ?? key).join(', ')}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
