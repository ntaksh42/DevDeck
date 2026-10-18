import { afterEach, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { PullRequestSearch } from "@/features/pull-requests/PullRequestSearch";
import { WorkItemSearch } from "@/features/work-items/WorkItemSearch";

afterEach(() => { cleanup(); window.localStorage.clear(); });

it.each([
  { Component: PullRequestSearch, query: "42", filter: "Filter by Repository", title: "Add pull request search dashboard" },
  { Component: WorkItemSearch, query: "123", filter: "Filter by State", title: "Validate onboarding with PAT credentials" },
])("clears column filters for external lookup $query", async ({ Component, query, filter, title }) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Harness() {
    const [request, setRequest] = useState<{ query: string; requestId: number } | null>({ query, requestId: 1 });
    return <QueryClientProvider client={client}>
      <button onClick={() => setRequest({ query, requestId: 2 })}>External lookup</button>
      <Component externalSearch={request} onExternalSearchHandled={() => setRequest(null)} />
    </QueryClientProvider>;
  }
  render(<Harness />);
  await screen.findAllByText(title);
  fireEvent.click(screen.getByRole("button", { name: filter }));
  fireEvent.click(screen.getByRole("button", { name: "Uncheck all" }));
  fireEvent.keyDown(document, { key: "Escape" });
  await waitFor(() => expect(screen.queryAllByText(title)).toHaveLength(0));
  fireEvent.click(screen.getByRole("button", { name: "External lookup" }));
  await screen.findAllByText(title);
});
