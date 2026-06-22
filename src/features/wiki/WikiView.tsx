import {
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, Loader2, Search } from "lucide-react";
import {
  commandErrorMessage,
  getWikiPage,
  listPipelineProjects,
  listWikiPages,
  listWikis,
  type Organization,
} from "@/lib/azdoCommands";
import { MarkdownView } from "@/lib/markdown";
import { openExternalUrl } from "@/lib/openExternal";
import { ResizeHandle } from "@/components/ResizeHandle";
import { storedNumber } from "@/lib/utils";

const DEFAULT_WIKI_PREVIEW_WIDTH = 560;
const MIN_WIKI_PREVIEW_WIDTH = 360;
const MAX_WIKI_PREVIEW_WIDTH = 8192;
const WIKI_PREVIEW_WIDTH_STORAGE_KEY = "azdodeck:layout:wikiPreviewWidth";

const selectClasses =
  "h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60";

export function WikiView({ organizations }: { organizations: Organization[] }) {
  const [organizationId, setOrganizationId] = useState(() => organizations[0]?.id ?? "");
  const [projectId, setProjectId] = useState("");
  const [wikiId, setWikiId] = useState("");
  const [filter, setFilter] = useState("");
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [previewWidth, setPreviewWidth] = useState(() =>
    storedNumber(
      WIKI_PREVIEW_WIDTH_STORAGE_KEY,
      DEFAULT_WIKI_PREVIEW_WIDTH,
      MIN_WIKI_PREVIEW_WIDTH,
      MAX_WIKI_PREVIEW_WIDTH,
    ),
  );

  useEffect(() => {
    window.localStorage.setItem(WIKI_PREVIEW_WIDTH_STORAGE_KEY, String(Math.round(previewWidth)));
  }, [previewWidth]);

  const selectedOrganizationId = organizationId || organizations[0]?.id || "";

  const projectsQuery = useQuery({
    queryKey: ["wikiProjects", selectedOrganizationId],
    queryFn: () => listPipelineProjects({ organizationId: selectedOrganizationId }),
    enabled: !!selectedOrganizationId,
    staleTime: 5 * 60_000,
  });
  const projects = projectsQuery.data ?? [];
  useEffect(() => {
    if (!projectId && projects.length > 0) setProjectId(projects[0].id);
  }, [projectId, projects]);

  const wikisQuery = useQuery({
    queryKey: ["wikis", selectedOrganizationId, projectId],
    queryFn: () => listWikis({ organizationId: selectedOrganizationId, projectId }),
    enabled: !!selectedOrganizationId && !!projectId,
    staleTime: 5 * 60_000,
  });
  const wikis = wikisQuery.data ?? [];
  useEffect(() => {
    // Reset the wiki selection when the project changes; pick the first wiki.
    if (wikis.length > 0 && !wikis.some((wiki) => wiki.id === wikiId)) {
      setWikiId(wikis[0].id);
      setSelectedPath(null);
    }
  }, [wikis, wikiId]);

  const pagesQuery = useQuery({
    queryKey: ["wikiPages", selectedOrganizationId, projectId, wikiId],
    queryFn: () => listWikiPages({ organizationId: selectedOrganizationId, projectId, wikiId }),
    enabled: !!selectedOrganizationId && !!projectId && !!wikiId,
    staleTime: 60_000,
  });
  const pages = pagesQuery.data ?? [];

  const filteredPages = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return pages;
    return pages.filter(
      (page) =>
        page.title.toLowerCase().includes(needle) ||
        page.path.toLowerCase().includes(needle),
    );
  }, [pages, filter]);

  const pageQuery = useQuery({
    queryKey: ["wikiPage", selectedOrganizationId, projectId, wikiId, selectedPath],
    queryFn: () =>
      getWikiPage({
        organizationId: selectedOrganizationId,
        projectId,
        wikiId,
        path: selectedPath as string,
      }),
    enabled: !!selectedOrganizationId && !!projectId && !!wikiId && selectedPath != null,
  });
  const page = pageQuery.data ?? null;

  function onListKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const buttons = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>("button[data-wiki-page]"),
    );
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === "ArrowDown") buttons[index + 1]?.focus();
    else if (index > 0) buttons[index - 1].focus();
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="shrink-0 rounded-md border border-border bg-card">
        <div className="grid gap-3 p-3 md:grid-cols-2 xl:grid-cols-3">
          {organizations.length > 1 ? (
            <label className="grid gap-2">
              <span className="text-sm font-medium">Organization</span>
              <select
                value={selectedOrganizationId}
                onChange={(event) => {
                  setOrganizationId(event.target.value);
                  setProjectId("");
                  setWikiId("");
                  setSelectedPath(null);
                }}
                className={selectClasses}
              >
                {organizations.map((org) => (
                  <option key={org.id} value={org.id}>
                    {org.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <label className="grid gap-2">
            <span className="text-sm font-medium">Project</span>
            <select
              value={projectId}
              onChange={(event) => {
                setProjectId(event.target.value);
                setWikiId("");
                setSelectedPath(null);
              }}
              disabled={projectsQuery.isLoading || projects.length === 0}
              className={selectClasses}
            >
              {projects.length === 0 ? <option value="">No projects</option> : null}
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>

          <label className="grid gap-2">
            <span className="text-sm font-medium">Wiki</span>
            <select
              value={wikiId}
              onChange={(event) => {
                setWikiId(event.target.value);
                setSelectedPath(null);
              }}
              disabled={wikisQuery.isLoading || wikis.length === 0}
              className={selectClasses}
            >
              {wikis.length === 0 ? <option value="">No wikis</option> : null}
              {wikis.map((wiki) => (
                <option key={wiki.id} value={wiki.id}>
                  {wiki.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div
        className="grid min-h-0 flex-1 items-stretch gap-3 xl:grid-cols-[minmax(220px,1fr)_8px_minmax(360px,var(--wiki-preview-width))]"
        style={{ "--wiki-preview-width": `${previewWidth}px` } as CSSProperties}
      >
        <div className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-md border border-border bg-card">
          <div className="shrink-0 border-b border-border p-2">
            <div className="flex h-8 items-center rounded-md border border-input bg-background px-2 focus-within:ring-2 focus-within:ring-ring">
              <Search className="mr-2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <input
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                placeholder="Filter pages…"
                aria-label="Filter wiki pages"
                className="min-w-0 flex-1 bg-transparent text-sm outline-none"
              />
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto" onKeyDown={onListKeyDown}>
            {pagesQuery.isLoading ? (
              <div className="flex items-center gap-2 px-3 py-3 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading pages…
              </div>
            ) : pagesQuery.isError ? (
              <p className="px-3 py-3 text-sm text-destructive">
                {commandErrorMessage(pagesQuery.error)}
              </p>
            ) : filteredPages.length === 0 ? (
              <p className="px-3 py-3 text-sm text-muted-foreground">
                {pages.length === 0 ? "No wiki pages." : "No pages match the filter."}
              </p>
            ) : (
              filteredPages.map((node) => (
                <button
                  key={node.path}
                  type="button"
                  data-wiki-page
                  onClick={() => setSelectedPath(node.path)}
                  style={{ paddingLeft: `${8 + node.depth * 14}px` }}
                  title={node.path}
                  className={`flex w-full items-center gap-1.5 border-b border-border/60 py-1 pr-2 text-left text-sm outline-none focus:ring-2 focus:ring-inset focus:ring-ring hover:bg-muted/50 ${
                    node.path === selectedPath ? "bg-secondary font-medium" : ""
                  }`}
                >
                  <span className="truncate">{node.title}</span>
                  {node.isParentPage ? (
                    <span className="shrink-0 text-[10px] text-muted-foreground">/…</span>
                  ) : null}
                </button>
              ))
            )}
          </div>
        </div>

        <ResizeHandle
          ariaLabel="Resize wiki preview"
          className="hidden xl:flex"
          direction={-1}
          max={MAX_WIKI_PREVIEW_WIDTH}
          min={MIN_WIKI_PREVIEW_WIDTH}
          onChange={setPreviewWidth}
          onReset={() => setPreviewWidth(DEFAULT_WIKI_PREVIEW_WIDTH)}
          value={previewWidth}
        />

        <aside className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-md border border-border bg-card">
          {selectedPath == null ? (
            <div className="flex h-full items-center justify-center px-3 text-sm text-muted-foreground">
              Select a page to preview.
            </div>
          ) : pageQuery.isLoading ? (
            <div className="flex h-full items-center justify-center gap-2 px-3 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading page…
            </div>
          ) : pageQuery.isError || !page ? (
            <p className="px-3 py-4 text-sm text-destructive">
              {commandErrorMessage(pageQuery.error) || "Page unavailable."}
            </p>
          ) : (
            <>
              <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2">
                <h2 className="truncate text-sm font-semibold" title={page.path}>
                  {page.title}
                </h2>
                {page.remoteUrl ? (
                  <button
                    type="button"
                    onClick={() => openExternalUrl(page.remoteUrl as string)}
                    className="inline-flex shrink-0 items-center gap-1 text-xs text-primary hover:underline"
                  >
                    <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                    Open
                  </button>
                ) : null}
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2 text-sm">
                {page.content.trim() ? (
                  <MarkdownView text={page.content} />
                ) : (
                  <p className="text-muted-foreground">This page has no content.</p>
                )}
              </div>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
