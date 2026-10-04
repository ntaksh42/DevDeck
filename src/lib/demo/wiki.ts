const DEMO_WIKI_BASE = "https://dev.azure.com/contoso/Demo%20Project/_wiki/wikis/Demo-Project.wiki";

const DEMO_WIKI_PAGES = [
  {
    fileName: "Deploy-Guide.md",
    pagePath: "/Deploy Guide",
    content:
      "# Deploy Guide\n\nRelease builds are produced by the **main** pipeline.\n\n## Steps\n\n1. Merge the pull request.\n2. Wait for the `main` pipeline to finish.\n3. Approve the production stage.\n\nSee [Runbook](/Runbook) for rollback.",
  },
  {
    fileName: "Runbook.md",
    pagePath: "/Runbook",
    content:
      "# Runbook\n\n## Rollback\n\nRe-run the previous successful `main` pipeline run and approve the production stage.",
  },
];

function demoWikiUrl(pagePath: string) {
  return `${DEMO_WIKI_BASE}?pagePath=${encodeURIComponent(pagePath)}`;
}

export function demoSearchWiki(query: string) {
  const needle = query.toLowerCase();
  const results = needle
    ? DEMO_WIKI_PAGES.filter((page) =>
        `${page.pagePath} ${page.content}`.toLowerCase().includes(needle),
      ).map((page) => ({
        fileName: page.fileName,
        pagePath: page.pagePath,
        projectId: "demo-project",
        projectName: "Demo Project",
        wikiId: "demo-wiki",
        wikiName: "Demo-Project.wiki",
        webUrl: demoWikiUrl(page.pagePath),
      }))
    : [];
  return { count: results.length, results, notice: null };
}

export function demoGetWikiPage(pagePath: string) {
  const page = DEMO_WIKI_PAGES.find((candidate) => candidate.pagePath === pagePath);
  return {
    pagePath,
    content: page?.content ?? `# ${pagePath.replace(/^\//, "")}\n\n(demo page)`,
    webUrl: demoWikiUrl(pagePath),
  };
}
