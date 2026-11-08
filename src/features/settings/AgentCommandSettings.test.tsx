import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { getAppSettings } from "@/lib/azdoCommands";
import { AgentCommandSettings } from "./AgentCommandSettings";

afterEach(cleanup);

async function renderSettings() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(["appSettings"], { ...(await getAppSettings()), agentWorkspacePath: null, autoAgentEnabled: false });
  render(
    <QueryClientProvider client={client}>
      <AgentCommandSettings />
    </QueryClientProvider>,
  );
}

describe("AgentCommandSettings", () => {
  it("warns when automatic review is on but the workspace folder is empty", async () => {
    await renderSettings();
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(screen.getByLabelText("Review pull requests and investigate work items automatically"));
    expect(screen.getByRole("alert").textContent).toContain("workspace folder is empty");
    fireEvent.change(screen.getByLabelText(/^Workspace folder/), { target: { value: "D:\src" } });
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
