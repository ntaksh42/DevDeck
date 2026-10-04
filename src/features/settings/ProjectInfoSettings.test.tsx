import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const listPipelineProjects = vi.fn();
const listProjectTeams = vi.fn();
const listServiceConnections = vi.fn();
const listServiceHooks = vi.fn();

vi.mock("@/lib/azdoCommands", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/azdoCommands")>()),
  listPipelineProjects: (...args: unknown[]) => listPipelineProjects(...args),
  listProjectTeams: (...args: unknown[]) => listProjectTeams(...args),
  listServiceConnections: (...args: unknown[]) => listServiceConnections(...args),
  listServiceHooks: (...args: unknown[]) => listServiceHooks(...args),
}));
vi.mock("@/lib/useActiveConnection", () => ({ useActiveOrganizationId: () => "org-1" }));

import { ProjectInfoSettings } from "./ProjectInfoSettings";

function renderPanel() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ProjectInfoSettings />
    </QueryClientProvider>,
  );
}

// jsdom does not toggle <details> from a summary click, so open it directly and
// fire the toggle event React listens to.
function openSection(name: string) {
  const details = screen.getByText(name).closest("details") as HTMLDetailsElement;
  details.open = true;
  fireEvent(details, new Event("toggle"));
  return details;
}

beforeEach(() => {
  listPipelineProjects.mockReset().mockResolvedValue([
    { id: "p-1", name: "Platform" },
    { id: "p-2", name: "Mobile" },
  ]);
  listProjectTeams.mockReset().mockResolvedValue({
    truncated: false,
    teams: [
      {
        id: "t-1",
        name: "Core",
        description: "The core team",
        members: [
          { displayName: "Ann", uniqueName: "ann@contoso.com", isTeamAdmin: true },
          { displayName: "Bob", uniqueName: null, isTeamAdmin: false },
        ],
      },
    ],
  });
  listServiceConnections.mockReset().mockResolvedValue([
    { id: "e-1", name: "Azure prod", endpointType: "azurerm", description: null, isReady: false, isShared: true },
  ]);
  listServiceHooks.mockReset().mockResolvedValue([
    { id: "h-1", status: "enabled", publisher: "tfs", eventType: "git.push", consumer: "slack", consumerAction: "post" },
  ]);
});
afterEach(cleanup);

describe("ProjectInfoSettings", () => {
  it("loads each section only when it is opened, for the selected project", async () => {
    renderPanel();
    expect(await screen.findByRole("combobox", { name: "Project" })).toBeTruthy();
    expect(listProjectTeams).not.toHaveBeenCalled();

    const teams = openSection("Teams");
    expect(await within(teams).findByText("Core")).toBeTruthy();
    expect(within(teams).getByText("(2 members)")).toBeTruthy();
    expect(within(teams).getByText("admin")).toBeTruthy();
    expect(listProjectTeams).toHaveBeenCalledWith({ organizationId: "org-1", projectId: "p-1" });
    expect(listServiceConnections).not.toHaveBeenCalled();

    const connections = openSection("Service connections");
    expect(await within(connections).findByText("Azure prod")).toBeTruthy();
    expect(within(connections).getByText("Not ready")).toBeTruthy();
    expect(within(connections).getByText("Shared")).toBeTruthy();

    const hooks = openSection("Service hooks");
    expect(await within(hooks).findByText("git.push")).toBeTruthy();
    expect(within(hooks).getByText("slack · post")).toBeTruthy();
  });

  it("reloads a section for another project after the selection changes", async () => {
    renderPanel();
    const select = (await screen.findByRole("combobox", { name: "Project" })) as HTMLSelectElement;
    openSection("Teams");
    await waitFor(() => expect(listProjectTeams).toHaveBeenCalledTimes(1));

    fireEvent.change(select, { target: { value: "p-2" } });
    openSection("Teams");

    await waitFor(() =>
      expect(listProjectTeams).toHaveBeenLastCalledWith({ organizationId: "org-1", projectId: "p-2" }),
    );
  });

  it("shows a section's error without breaking the others", async () => {
    listServiceConnections.mockRejectedValue("Missing the Service Endpoints (read) scope");
    renderPanel();
    await screen.findByRole("combobox", { name: "Project" });

    const connections = openSection("Service connections");
    expect((await within(connections).findByRole("alert")).textContent).toBe(
      "Missing the Service Endpoints (read) scope",
    );
    const hooks = openSection("Service hooks");
    expect(await within(hooks).findByText("git.push")).toBeTruthy();
  });

  it("offers no edit actions", async () => {
    renderPanel();
    await screen.findByRole("combobox", { name: "Project" });
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });
});
