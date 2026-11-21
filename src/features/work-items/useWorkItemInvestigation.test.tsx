import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { WorkItemSummary } from "@/lib/azdoCommands";
import { useWorkItemInvestigation } from "./useWorkItemInvestigation";
import { InvestigateSplitButton } from "./InvestigateSplitButton";

const run = vi.fn().mockResolvedValue(1);
vi.mock("@/lib/azdoCommands", () => ({ runWorkItemInvestigations: (...args: unknown[]) => run(...args), commandErrorMessage: String }));
afterEach(() => { cleanup(); run.mockClear(); });
function Harness({ items }: { items: WorkItemSummary[] }) {
  const action = useWorkItemInvestigation(items);
  return <InvestigateSplitButton {...action} title="Investigate" />;
}
const item = (id: number) => ({ id, organizationId: "org", projectId: "p", projectName: "Project", title: `Item ${id}` }) as WorkItemSummary;
function setup(items: WorkItemSummary[]) {
  render(<QueryClientProvider client={new QueryClient()}><Harness items={items} /></QueryClientProvider>);
}
it("requests one focused item without checkbox selection", async () => {
  setup([item(1)]);
  fireEvent.click(screen.getByRole("button", { name: "Investigate" }));
  await waitFor(() => expect(run).toHaveBeenCalledWith([item(1)], undefined));
});
it("keeps all selected targets and the chosen agent", async () => {
  setup([item(1), item(2)]);
  fireEvent.click(screen.getByRole("button", { name: "Choose the agent for the investigation" }));
  fireEvent.click(screen.getByRole("menuitemradio", { name: "Codex" }));
  fireEvent.click(screen.getByRole("button", { name: /Investigate.*Codex/ }));
  await waitFor(() => expect(run).toHaveBeenCalledWith([item(1), item(2)], "codex"));
});
it("does not submit an empty list", () => {
  setup([]);
  fireEvent.click(screen.getByRole("button", { name: "Investigate" }));
  expect(run).not.toHaveBeenCalled();
});

