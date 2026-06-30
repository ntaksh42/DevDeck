import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CodeFileView } from "./CodeFileView";
import { type RepoOption } from "./codeBrowseShared";

const repo: RepoOption = {
  projectId: "p1",
  projectName: "Demo Project",
  repositoryId: "r1",
  repositoryName: "azdo-dashboard",
};

// Drives the browser demo runtime (no Tauri), so getRepoFile/getRepoFileBinary
// resolve via the demo dispatchers.
function renderFile(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CodeFileView organization={undefined} organizationId="demo" repo={repo} branch="main" path={path} />
    </QueryClientProvider>,
  );
}

afterEach(cleanup);

describe("CodeFileView", () => {
  it("renders a Markdown file as formatted HTML by default, with a Raw toggle", async () => {
    renderFile("/README.md");
    // "# azdo-dashboard" renders as a heading, not literal "#" text.
    expect(await screen.findByRole("heading", { name: "azdo-dashboard" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Raw" }));
    expect(await screen.findByText(/# azdo-dashboard/)).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "azdo-dashboard" })).toBeNull();
  });

  it("does not show the Rendered/Raw toggle for non-Markdown files", async () => {
    const { container } = renderFile("/package.json");
    // highlight.js splits JSON tokens across spans, so match on the code
    // block's combined text rather than a single text node.
    await waitFor(() =>
      expect(container.querySelector("code.hljs")?.textContent ?? "").toContain(
        '"name": "azdo-dashboard"',
      ),
    );
    expect(screen.queryByRole("button", { name: "Raw" })).toBeNull();
  });

  it("previews an image file inline as a data URL, by file extension", async () => {
    renderFile("/logo.png");
    const image = await screen.findByRole("img");
    expect(image.getAttribute("src")).toMatch(/^data:image\/png;base64,/);
  });
});
