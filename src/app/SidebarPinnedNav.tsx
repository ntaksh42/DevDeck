import { Bot, Inbox, Sparkles } from "lucide-react";
import { NavButton } from "@/components/Nav";
import { useHomeNewCount } from "@/features/home/useHomeBot";
import type { View } from "./types";

/** The views pinned above the reorderable sections: Home, Inbox, Agent Work. */
export function SidebarPinnedNav({
  activeView,
  disabled,
  inboxBadge,
  onNavigate,
}: {
  activeView: View;
  disabled: boolean;
  inboxBadge: number | null;
  onNavigate: (view: View) => void;
}) {
  const homeBadge = useHomeNewCount(!disabled && activeView !== "home");
  return (
    <div className="mb-1">
      <NavButton
        active={activeView === "home"}
        disabled={disabled}
        icon={<Sparkles className="h-4 w-4" aria-hidden="true" />}
        label="Home"
        badge={activeView === "home" ? null : homeBadge}
        onClick={() => onNavigate("home")}
      />
      <NavButton
        active={activeView === "inbox"}
        disabled={disabled}
        icon={<Inbox className="h-4 w-4" aria-hidden="true" />}
        label="Inbox"
        badge={inboxBadge}
        onClick={() => onNavigate("inbox")}
      />
      <NavButton
        active={activeView === "autoQueue"}
        disabled={disabled}
        icon={<Bot className="h-4 w-4" aria-hidden="true" />}
        label="Agent Work"
        onClick={() => onNavigate("autoQueue")}
      />
    </div>
  );
}
