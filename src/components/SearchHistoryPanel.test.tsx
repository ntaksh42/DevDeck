import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SearchHistoryPanel } from "./SearchHistoryPanel";

afterEach(cleanup);

function History() {
  const [rows, setRows] = useState([
    { id: "a", primary: "alpha" },
    { id: "b", primary: "beta" },
  ]);
  return <>
    <input placeholder="Search work items…" aria-label="Search" />
    <SearchHistoryPanel
      sections={[{ kind: "recent", title: "Recent", rows }]}
      emptyMessage="Run a search"
      onRun={vi.fn()}
      onPin={vi.fn()}
      onRemove={(_, id) => setRows((current) => current.filter((row) => row.id !== id))}
    />
  </>;
}

describe("SearchHistoryPanel removal focus", () => {
  it("returns focus from a removed button to the neighbouring history row", async () => {
    render(<History />);
    const remove = screen.getByRole("button", { name: "Remove search alpha" });
    remove.focus();
    fireEvent.click(remove);
    await waitFor(() => expect(document.activeElement?.getAttribute("data-id")).toBe("b"));
  });

  it("returns focus to search when Delete removes the last history row", async () => {
    render(<History />);
    const first = document.querySelector<HTMLElement>("[data-history-row]")!;
    first.focus();
    fireEvent.keyDown(first, { key: "Delete" });
    await waitFor(() => expect(document.activeElement?.getAttribute("data-id")).toBe("b"));
    fireEvent.keyDown(document.activeElement!, { key: "Delete" });
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Search" })));
  });
});
