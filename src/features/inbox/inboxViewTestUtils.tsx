import { render, screen, waitFor, within } from "@testing-library/react";
import { expect } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { InboxView } from "./InboxView";

// Shared by the InboxView test files. The view reads the browser demo's seeded
// Inbox: four stored items (PR / WI mentions and a reply).

export function renderView() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <InboxView />
    </QueryClientProvider>,
  );
}

/** The list's rows. */
export function storedRows(list: HTMLElement): HTMLElement[] {
  return within(list).queryAllByRole("option");
}

export async function openList() {
  const list = await screen.findByRole("listbox", { name: "Inbox items" });
  await waitFor(() => {
    expect(storedRows(list)).toHaveLength(4);
  });
  return list;
}

export function rowFor(list: HTMLElement, text: string): HTMLElement {
  const row = within(list)
    .getAllByRole("option")
    .find((candidate) => candidate.textContent?.includes(text));
  if (!row) throw new Error(`no row containing ${text}`);
  return row;
}
