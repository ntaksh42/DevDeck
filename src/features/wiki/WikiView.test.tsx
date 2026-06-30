import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WikiView } from "./WikiView";

vi.mock("@/lib/openExternal", () => ({
  openExternalUrl: vi.fn(),
}));

function renderView() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <WikiView />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("WikiView", () => {
  it("prompts to search before a query is entered", () => {
    renderView();
    expect(screen.getByText("Search for a keyword to find wiki pages.")).toBeTruthy();
  });

  it(
    "shows matching demo pages and previews the first hit",
    async () => {
      renderView();
      const input = screen.getByRole("searchbox", { name: "Search wiki pages" });
      fireEvent.change(input, { target: { value: "the" } });

      // Both demo pages mention "the" in their body text.
      await waitFor(() => expect(screen.getByText("Getting-Started.md")).toBeTruthy(), {
        timeout: 5000,
      });
      expect(screen.getByText("Release-Process.md")).toBeTruthy();

      // The first hit is selected by default and its content renders as Markdown.
      await waitFor(
        () =>
          expect(
            screen.getByText("Onboarding steps for new contributors:"),
          ).toBeTruthy(),
        { timeout: 5000 },
      );
    },
    10000,
  );

  it(
    "moves the selection and preview with the keyboard",
    async () => {
      renderView();
      const input = screen.getByRole("searchbox", { name: "Search wiki pages" });
      fireEvent.change(input, { target: { value: "the" } });

      await waitFor(() => expect(screen.getByText("Release-Process.md")).toBeTruthy(), {
        timeout: 5000,
      });

      const grid = screen.getByRole("grid", { name: "Wiki search results" });
      fireEvent.keyDown(grid, { key: "ArrowDown" });

      const secondRow = screen.getByText("Release-Process.md").closest("[role='row']");
      expect(secondRow?.getAttribute("aria-selected")).toBe("true");

      await waitFor(() => expect(screen.getByText("How releases are cut:")).toBeTruthy(), {
        timeout: 5000,
      });
    },
    10000,
  );

  it(
    "opens the selected page in the browser with O",
    async () => {
      const { openExternalUrl } = await import("@/lib/openExternal");
      renderView();
      const input = screen.getByRole("searchbox", { name: "Search wiki pages" });
      fireEvent.change(input, { target: { value: "the" } });

      await waitFor(() => expect(screen.getByText("Getting-Started.md")).toBeTruthy(), {
        timeout: 5000,
      });

      const grid = screen.getByRole("grid", { name: "Wiki search results" });
      fireEvent.keyDown(grid, { key: "o" });

      expect(openExternalUrl).toHaveBeenCalledWith(
        expect.stringContaining("Getting-Started"),
      );
    },
    10000,
  );
});
