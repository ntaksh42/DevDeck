import type { Organization } from "@/lib/azdoCommands";
import type { CommandPaletteSearchItem } from "@/components/CommandPalette";
import { openExternalUrl } from "@/lib/openExternal";

export type PaletteUrlTarget = {
  kind: "pullRequest" | "workItem" | "pipelineRun";
  id: number;
  url: string;
  /** Organization name taken from the URL (`dev.azure.com/{org}` or `{org}.visualstudio.com`). */
  organizationName: string;
  /** The registered connection for that organization, or null when it is not registered. */
  organizationId: string | null;
};

// Both host forms name the organization: dev.azure.com/{org}/… and {org}.visualstudio.com/….
function splitOrganization(url: URL): { org: string; rest: string[] } | null {
  const segments = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  const host = url.hostname.toLowerCase();
  if (host === "dev.azure.com") {
    const [org, ...rest] = segments;
    return org ? { org, rest } : null;
  }
  const legacy = host.match(/^([^.]+)\.visualstudio\.com$/);
  return legacy ? { org: legacy[1], rest: segments } : null;
}

function organizationNameOf(baseUrl: string): string | null {
  try {
    return splitOrganization(new URL(baseUrl))?.org.toLowerCase() ?? null;
  } catch {
    return null;
  }
}

function positiveInt(value: string | null | undefined): number | null {
  return value && /^\d+$/.test(value) && Number(value) > 0 ? Number(value) : null;
}

function findTarget(rest: string[], params: URLSearchParams): Pick<PaletteUrlTarget, "kind" | "id"> | null {
  const lower = rest.map((segment) => segment.toLowerCase());
  const pr = lower.indexOf("pullrequest");
  if (pr > 0 && lower.includes("_git")) {
    const id = positiveInt(rest[pr + 1]);
    if (id) return { kind: "pullRequest", id };
  }
  const edit = lower.indexOf("_workitems");
  if (edit >= 0 && lower[edit + 1] === "edit") {
    const id = positiveInt(rest[edit + 2]);
    if (id) return { kind: "workItem", id };
  }
  // Boards / sprints / backlogs open an item in a dialog via ?workitem=N.
  const dialogItem = positiveInt(params.get("workitem"));
  if (dialogItem) return { kind: "workItem", id: dialogItem };
  if (lower.includes("_build") && lower.includes("results")) {
    const id = positiveInt(params.get("buildId"));
    if (id) return { kind: "pipelineRun", id };
  }
  return null;
}

/**
 * Reads a pasted Azure DevOps web URL (pull request, work item or pipeline run).
 * Returns null for anything else so ordinary palette input behaves as before.
 */
export function parsePaletteUrl(
  text: string,
  organizations: Pick<Organization, "id" | "baseUrl">[],
): PaletteUrlTarget | null {
  const trimmed = text.trim();
  if (!/^https?:\/\//i.test(trimmed)) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  let parts: ReturnType<typeof splitOrganization>;
  try {
    parts = splitOrganization(url);
  } catch {
    return null; // malformed percent-encoding
  }
  if (!parts) return null;
  const target = findTarget(parts.rest, url.searchParams);
  if (!target) return null;
  const orgKey = parts.org.toLowerCase();
  const organization = organizations.find((org) => organizationNameOf(org.baseUrl) === orgKey);
  return {
    ...target,
    url: trimmed,
    organizationName: parts.org,
    organizationId: organization?.id ?? null,
  };
}

/** Palette rows for a pasted URL: open it in DevDeck where a view can show it, else in the browser. */
export function paletteUrlItems(
  target: PaletteUrlTarget,
  activeOrganizationId: string,
  openInApp: (kind: "workItems" | "pullRequests", query: string, organizationId: string) => void,
): CommandPaletteSearchItem[] {
  const openInBrowser = () => {
    void openExternalUrl(target.url);
  };
  if (!target.organizationId) {
    return [
      {
        id: "url:unregistered",
        group: "Link",
        label: `Organization "${target.organizationName}" is not registered — open in browser`,
        detail: "Add it under Settings › Connections to open its links in DevDeck.",
        run: openInBrowser,
        runAlt: openInBrowser,
      },
    ];
  }
  const organizationId = target.organizationId;
  if (target.kind === "pipelineRun") {
    return [
      {
        id: `url:run:${target.id}`,
        group: "Link",
        label: `Open pipeline run ${target.id} in browser`,
        run: openInBrowser,
        runAlt: openInBrowser,
      },
    ];
  }
  const isPr = target.kind === "pullRequest";
  return [
    {
      id: `url:${target.kind}:${organizationId}:${target.id}`,
      group: "Link",
      label: isPr ? `Open pull request !${target.id}` : `Open work item #${target.id}`,
      detail:
        organizationId === activeOrganizationId
          ? target.organizationName
          : `Switches the active connection to ${target.organizationName}`,
      run: () => openInApp(isPr ? "pullRequests" : "workItems", String(target.id), organizationId),
      runAlt: openInBrowser,
    },
  ];
}
