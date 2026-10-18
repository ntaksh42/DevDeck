import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { loadSearchHistory } from "@/lib/searchHistory";
import { PullRequestSearch } from "./PullRequestSearch";
import type { PrSearchFilters } from "./prSearchHistoryHelpers";

afterEach(cleanup);
beforeEach(() => window.localStorage.clear());

function mount() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <PullRequestSearch />
    </QueryClientProvider>,
  );
}

async function runSearch(text: string) {
  const input = screen.getByPlaceholderText("title, author, branch…");
  fireEvent.change(input, { target: { value: text } });
  await waitFor(() => expect((screen.getByRole("button", { name: /^Search/ }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: /^Search/ }));
  await waitFor(() => expect(loadSearchHistory<PrSearchFilters>("prSearch").recent[0]?.query).toBe(text));
}

const rows = () => Array.from(document.querySelectorAll<HTMLElement>("[data-history-row]"));

describe("PR Search recent / saved searches", () => {
  it("records an executed search and lists it in the empty state on next visit", async () => {
    const first = mount();
    await runSearch("login bug");
    first.unmount();

    mount();
    expect(await screen.findByText("Recent searches")).toBeTruthy();
    expect(rows()[0].textContent).toContain("login bug");
    expect(rows()[0].textContent).toContain("active");
  });

  it("re-runs a recent search with its query when Enter is pressed", async () => {
    const first = mount();
    await runSearch("alpha");
    first.unmount();

    mount();
    const row = (await waitFor(() => {
      expect(rows()).toHaveLength(1);
      return rows()[0];
    }));
    row.focus();
    fireEvent.keyDown(row, { key: "Enter" });
    await waitFor(() => expect(screen.queryByText("Recent searches")).toBeNull());
    expect((screen.getByPlaceholderText("title, author, branch…") as HTMLInputElement).value).toBe("alpha");
  });

  it("pins with S, moves with arrows and removes with Delete", async () => {
    const first = mount();
    await runSearch("one");
    first.unmount();
    const second = mount();
    await runSearch("two");
    second.unmount();

    mount();
    await waitFor(() => expect(rows()).toHaveLength(2));
    expect(rows()[0].textContent).toContain("two");
    rows()[0].focus();
    fireEvent.keyDown(rows()[0], { key: "ArrowDown" });
    expect(document.activeElement).toBe(rows()[1]);

    fireEvent.keyDown(rows()[1], { key: "s" });
    await waitFor(() => expect(screen.getByText("Saved")).toBeTruthy());
    expect(loadSearchHistory<PrSearchFilters>("prSearch").saved.map((e) => e.query)).toEqual(["one"]);

    fireEvent.keyDown(rows()[0], { key: "Delete" });
    await waitFor(() =>
      expect(loadSearchHistory<PrSearchFilters>("prSearch").recent.map((e) => e.query)).toEqual(["one"]),
    );
  });
});
