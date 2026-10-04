import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { getAppSettings } from "@/lib/azdoCommands";
import { NotificationRulesSettings } from "./NotificationRulesSettings";

afterEach(() => {
  cleanup();
});

// Seed the settings so the draft is ready on mount; otherwise the query result
// arriving later would replace a rule added before it loaded.
async function renderRules() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(["appSettings"], await getAppSettings());
  render(
    <QueryClientProvider client={client}>
      <NotificationRulesSettings />
    </QueryClientProvider>,
  );
}

describe("NotificationRulesSettings", () => {
  it("keeps spaces while typing a project name containing a space", async () => {
    await renderRules();
    fireEvent.click(await screen.findByRole("button", { name: "Add rule" }));
    const projects = screen.getByPlaceholderText("Platform, Mobile") as HTMLInputElement;

    fireEvent.change(projects, { target: { value: "My " } });
    expect(projects.value).toBe("My ");

    fireEvent.change(projects, { target: { value: "My Project, Demo " } });
    expect(projects.value).toBe("My Project, Demo ");
    expect(screen.getByRole("button", { name: "Save rules" })).toBeTruthy();
  });

  it("keeps spaces in repository names too", async () => {
    await renderRules();
    fireEvent.click(await screen.findByRole("button", { name: "Add rule" }));
    const repositories = screen.getByPlaceholderText("web-app, api") as HTMLInputElement;

    fireEvent.change(repositories, { target: { value: "web app" } });

    expect(repositories.value).toBe("web app");
  });
});
