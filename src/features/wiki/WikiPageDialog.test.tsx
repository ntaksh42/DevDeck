import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { WikiSearchHit } from "@/lib/azdoCommands";

const getWikiPage = vi.fn();
const openExternalUrl = vi.fn();

vi.mock("@/lib/azdoCommands", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/azdoCommands")>()),
  getWikiPage: (...args: unknown[]) => getWikiPage(...args),
}));
vi.mock("@/lib/openExternal", () => ({
  openExternalUrl: (...args: unknown[]) => openExternalUrl(...args),
}));

import { WikiPageDialog } from "./WikiPageDialog";

const hit: WikiSearchHit = {
  fileName: "Deploy-Guide.md",
  pagePath: "/Deploy Guide",
  projectId: "p-1",
  projectName: "Platform",
  wikiId: "w-1",
  wikiName: "Platform.wiki",
  webUrl: "https://dev.azure.com/contoso/Platform/_wiki/wikis/Platform.wiki?pagePath=%2FDeploy%20Guide",
};

function renderDialog(onClose = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <WikiPageDialog hit={hit} organizationId="org-1" onClose={onClose} />
    </QueryClientProvider>,
  );
  return onClose;
}

describe("WikiPageDialog", () => {
  beforeEach(() => {
    getWikiPage.mockReset().mockResolvedValue({
      pagePath: "/Deploy Guide",
      content: "# Deploy Guide\n\nRun the pipeline.",
      webUrl: hit.webUrl,
    });
    openExternalUrl.mockReset();
  });
  afterEach(cleanup);

  it("renders the page body and focuses the scrollable body", async () => {
    renderDialog();

    expect(await screen.findByRole("heading", { name: "Deploy Guide", level: 1 })).toBeTruthy();
    expect(getWikiPage).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org-1", wikiId: "w-1", pagePath: "/Deploy Guide" }),
    );
    await waitFor(() => {
      expect(document.activeElement?.getAttribute("tabindex")).toBe("0");
    });
  });

  it("closes with Escape and opens the browser page from the button", async () => {
    const onClose = renderDialog();
    await screen.findByRole("heading", { name: "Deploy Guide", level: 1 });

    fireEvent.click(screen.getByRole("button", { name: /Open in Azure DevOps/ }));
    expect(openExternalUrl).toHaveBeenCalledWith(hit.webUrl);

    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("wraps Tab and Shift+Tab at the dialog edges", async () => {
    renderDialog();
    await screen.findByRole("heading", { name: "Deploy Guide", level: 1 });
    const open = screen.getByRole("button", { name: /Open in Azure DevOps/ });
    const body = document.activeElement as HTMLElement;

    // Tab order is Open -> Close -> body, so the body is the last stop.
    fireEvent.keyDown(body, { key: "Tab" });
    expect(document.activeElement).toBe(open);

    fireEvent.keyDown(open, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(body);
  });

  it("shows the error message when the page cannot be loaded", async () => {
    getWikiPage.mockRejectedValue("Page not found");
    renderDialog();

    expect((await screen.findByRole("alert")).textContent).toBe("Page not found");
  });
});
