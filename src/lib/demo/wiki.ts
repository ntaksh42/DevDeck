import type { WikiPageContent, WikiSearchHit, WikiSearchResults } from "@/lib/azdoCommands";

const DEMO_PAGES: Array<WikiSearchHit & { content: string }> = [
  {
    fileName: "Getting-Started.md",
    path: "/Getting-Started",
    projectName: "Demo Project",
    wikiId: "demo-wiki",
    wikiName: "Demo Project.wiki",
    webUrl: "https://dev.azure.com/demo/Demo%20Project/_wiki/wikis/demo-wiki?pagePath=%2FGetting-Started",
    snippet: "Onboarding steps for new contributors, including local setup",
    content:
      "# Getting Started\n\nOnboarding steps for new contributors:\n\n1. Clone the repository.\n2. Install dependencies.\n3. Run the app locally.\n",
  },
  {
    fileName: "Release-Process.md",
    path: "/Release-Process",
    projectName: "Demo Project",
    wikiId: "demo-wiki",
    wikiName: "Demo Project.wiki",
    webUrl: "https://dev.azure.com/demo/Demo%20Project/_wiki/wikis/demo-wiki?pagePath=%2FRelease-Process",
    snippet: "How releases are cut, including version bumps and changelog",
    content:
      "# Release Process\n\nHow releases are cut:\n\n- Bump the version.\n- Update the changelog.\n- Tag and publish.\n",
  },
];

export function demoSearchWikiPages(query: string): WikiSearchResults {
  const needle = query.trim().toLowerCase();
  const results = needle
    ? DEMO_PAGES.filter(
        (page) =>
          page.fileName.toLowerCase().includes(needle) ||
          page.content.toLowerCase().includes(needle),
      )
    : DEMO_PAGES;
  return {
    count: results.length,
    results: results.map(({ content: _content, ...hit }) => hit),
    notice: null,
  };
}

export function demoGetWikiPage(path: string): WikiPageContent {
  const page = DEMO_PAGES.find((candidate) => candidate.path === path) ?? DEMO_PAGES[0];
  return {
    path: page.path,
    content: page.content,
    webUrl: page.webUrl,
  };
}
