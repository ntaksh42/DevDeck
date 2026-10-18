import { afterEach, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WorkItemSearch } from "./WorkItemSearch";

afterEach(cleanup);

it("clears the previous result filter when opening an external work item", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = (requestId: number, query: string) => (
    <QueryClientProvider client={client}>
      <WorkItemSearch externalSearch={{ requestId, query }} />
    </QueryClientProvider>
  );
  const { rerender } = render(view(1, "123"));
  const grid = await screen.findByRole("grid", { name: "Work items" });
  await within(grid).findByText("Validate onboarding with PAT credentials");
  fireEvent.click(screen.getByRole("button", { name: /Filter work items/ }));
  fireEvent.change(screen.getByLabelText("Filter results"), { target: { value: "no-such-work-item" } });
  await waitFor(() => expect(within(grid).queryByText("Validate onboarding with PAT credentials")).toBeNull());

  rerender(view(2, "118"));
  await waitFor(() => expect(within(screen.getByRole("grid", { name: "Work items" }))
    .getByText("Rate limiting middleware causes 429 cascade on retries")).toBeTruthy());
  fireEvent.click(screen.getByRole("button", { name: /Filter work items/ }));
  expect((screen.getByLabelText("Filter results") as HTMLInputElement).value).toBe("");
});
