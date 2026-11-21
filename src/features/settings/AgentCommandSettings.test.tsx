import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { getAppSettings } from "@/lib/azdoCommands";
import { AgentCommandSettings } from "./AgentCommandSettings";

afterEach(cleanup);

async function renderSettings(legacySettings: Record<string, unknown> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(["appSettings"], { ...(await getAppSettings()), agentWorkspacePath: null, autoAgentEnabled: false, ...legacySettings });
  render(
    <QueryClientProvider client={client}>
      <AgentCommandSettings />
    </QueryClientProvider>,
  );
  return client;
}

describe("AgentCommandSettings", () => {
  it("saves automatic review without retaining the retired approval setting", async () => {
    const client = await renderSettings({ autoAgentApprovalEnabled: true });
    expect(screen.queryByLabelText("Choose what to run in Auto queue first")).toBeNull();
    fireEvent.click(screen.getByLabelText("Review pull requests and investigate work items automatically"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText("Agent command saved.");
    await waitFor(() => {
      const saved = client.getQueryData<Record<string, unknown>>(["appSettings"]);
      expect(saved?.autoAgentEnabled).toBe(true);
      expect(saved).not.toHaveProperty("autoAgentApprovalEnabled");
    });
  });

  it("warns when automatic review is on but the workspace folder is empty", async () => {
    await renderSettings();
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(screen.getByLabelText("Review pull requests and investigate work items automatically"));
    expect(screen.getByRole("alert").textContent).toContain("workspace folder is empty");
    fireEvent.change(screen.getByLabelText(/^Workspace folder/), { target: { value: "D:\src" } });
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
