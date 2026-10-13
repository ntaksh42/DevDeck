import { render, screen, waitFor, within } from "@testing-library/react";
import { expect } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { InboxView } from "./InboxView";

// Shared by the InboxView test files. The view reads the browser demo's seeded
// Inbox: six stored items plus the demo's derived approvals and agent replies.

export function renderView(props: { onOpenView?: (view: "pipelines") => void } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <InboxView {...props} />
    </QueryClientProvider>,
  );
}

export const isApproval = (row: HTMLElement) => row.textContent?.startsWith("Approval") ?? false;
/** Derived rows: live pipeline approvals and agent replies waiting for the user. */
export const isAgentRow = (row: HTMLElement) => /agent: \d+ notes? waiting/.test(row.textContent ?? "");
export const isDerived = (row: HTMLElement) => isApproval(row) || isAgentRow(row);

/** Rows of stored items (everything except the derived rows). */
export function storedRows(list: HTMLElement): HTMLElement[] {
  return within(list)
    .queryAllByRole("option")
    .filter((row) => !isDerived(row));
}

export async function openList() {
  const list = await screen.findByRole("listbox", { name: "Inbox items" });
  await waitFor(() => {
    expect(storedRows(list)).toHaveLength(6);
  });
  return list;
}

/** Approvals are fetched live after the stored items, so wait for them. */
export async function approvalRows(list: HTMLElement): Promise<HTMLElement[]> {
  await waitFor(() => {
    expect(within(list).queryAllByRole("option").filter(isApproval).length).toBeGreaterThan(0);
  });
  return within(list).getAllByRole("option").filter(isApproval);
}

export function rowFor(list: HTMLElement, text: string): HTMLElement {
  const row = within(list)
    .getAllByRole("option")
    .find((candidate) => candidate.textContent?.includes(text));
  if (!row) throw new Error(`no row containing ${text}`);
  return row;
}
