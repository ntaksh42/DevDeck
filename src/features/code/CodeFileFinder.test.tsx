import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CodeFileFinder } from "./CodeFileFinder";
import type { RepoOption } from "./codeBrowseShared";

const repo: RepoOption = {
  projectId: "platform",
  projectName: "Platform",
  repositoryId: "azdo-dashboard",
  repositoryName: "azdo-dashboard",
};

function renderFinder(onSelect = vi.fn(), onClose = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // A real button so focus-return on close can be asserted against it.
  document.body.innerHTML = "";
  const opener = document.createElement("button");
  opener.textContent = "opener";
  document.body.appendChild(opener);
  opener.focus();

  const result = render(
    <QueryClientProvider client={client}>
      <CodeFileFinder
        organizationId="org-1"
        repo={repo}
        branch="main"
        onSelect={onSelect}
        onClose={onClose}
      />
    </QueryClientProvider>,
  );
  return { ...result, opener, onSelect, onClose };
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("CodeFileFinder", () => {
  it("opens focused on the input", async () => {
    renderFinder();
    const input = screen.getByLabelText("Find file by name");
    await waitFor(() => expect(document.activeElement).toBe(input));
  });

  it("fuzzy-filters the full file list as the user types", async () => {
    renderFinder();
    const input = await screen.findByLabelText("Find file by name");
    await waitFor(() => expect(screen.getByText("/README.md")).toBeTruthy());
    fireEvent.change(input, { target: { value: "pkg" } });
    await waitFor(() => expect(screen.getByText("/package.json")).toBeTruthy());
    expect(screen.queryByText("/README.md")).toBeNull();
  });

  it("moves the active row with arrow keys and opens it with Enter", async () => {
    const onSelect = vi.fn();
    const { onClose } = renderFinder(onSelect);
    const input = await screen.findByLabelText("Find file by name");
    await waitFor(() => expect(screen.getByText("/README.md")).toBeTruthy());

    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onSelect).toHaveBeenCalledTimes(1);
    // First row (index 0, alphabetical with an empty query) is README.md;
    // ArrowDown moves to the second result, package.json.
    expect(onSelect).toHaveBeenCalledWith("/package.json");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes on Escape and returns focus to the opener", async () => {
    const { opener, onClose } = renderFinder();
    const input = await screen.findByLabelText("Find file by name");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);

    cleanup();
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });
});
