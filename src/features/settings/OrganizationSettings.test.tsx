import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Organization } from "@/lib/azdoCommands";
import { focusFilterInput } from "@/lib/utils";
import { OrganizationSettings } from "./OrganizationSettings";
import { filterSettingsGroups, SETTINGS_GROUPS } from "./settingsSections";

const organization = {
  id: "org-1",
  name: "contoso",
  displayName: null,
  baseUrl: "https://dev.azure.com/contoso",
  authProvider: "pat",
  providerKind: "azdo",
  authenticatedUserDisplayName: "Test User",
} as unknown as Organization;

afterEach(() => {
  cleanup();
});

function renderSettings() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <OrganizationSettings organizations={[organization]} />
    </QueryClientProvider>,
  );
}

describe("filterSettingsGroups", () => {
  it("matches every term against group label, title and keywords", () => {
    const result = filterSettingsGroups(SETTINGS_GROUPS, "dark THEME");
    expect(result.map((group) => group.id)).toEqual(["appearance"]);
    expect(result[0].entries.map((entry) => entry.id)).toEqual(["appearance"]);
  });

  it("drops entries rejected by the visibility predicate", () => {
    const result = filterSettingsGroups(SETTINGS_GROUPS, "diagnostics", (entry) => !entry.flag);
    expect(result).toEqual([]);
  });
});

describe("OrganizationSettings", () => {
  it("groups panels into labelled sections with a section nav", async () => {
    renderSettings();
    expect(await screen.findByRole("heading", { name: "Connections" })).toBeTruthy();
    const nav = screen.getByRole("navigation", { name: "Settings sections" });
    expect(within(nav).getByRole("button", { name: "Notifications" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Accounts" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Data & sync" })).toBeTruthy();
  });

  it("filters panels and disables sections without matches", async () => {
    renderSettings();
    const input = await screen.findByRole("searchbox", { name: "Filter settings" });
    fireEvent.change(input, { target: { value: "stale" } });

    expect(screen.getByRole("heading", { name: "My Reviews" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "My Work Items" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Connections" })).toBeNull();
    const nav = screen.getByRole("navigation", { name: "Settings sections" });
    expect(
      (within(nav).getByRole("button", { name: "Accounts" }) as HTMLButtonElement).disabled,
    ).toBe(true);

    // First Escape clears the filter and keeps focus in the field.
    input.focus();
    fireEvent.keyDown(input, { key: "Escape" });
    expect((input as HTMLInputElement).value).toBe("");
    expect(document.activeElement).toBe(input);
    expect(screen.getByRole("heading", { name: "Connections" })).toBeTruthy();
  });

  it("shows an empty state when nothing matches", async () => {
    renderSettings();
    const input = await screen.findByRole("searchbox", { name: "Filter settings" });
    fireEvent.change(input, { target: { value: "zzz-no-such-setting" } });
    expect(screen.getByText(/No settings match/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Clear filter" }));
    expect(screen.getByRole("heading", { name: "Connections" })).toBeTruthy();
  });

  it("Enter in the filter focuses the first matching panel's control", async () => {
    renderSettings();
    const input = await screen.findByRole("searchbox", { name: "Filter settings" });
    fireEvent.change(input, { target: { value: "theme" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(document.activeElement).toBe(screen.getByRole("radio", { name: "Light" }));
  });

  it("is the target of the focus-filter shortcut", async () => {
    renderSettings();
    const input = await screen.findByRole("searchbox", { name: "Filter settings" });
    expect(focusFilterInput()).toBe(true);
    expect(document.activeElement).toBe(input);
  });

  it("moves between section buttons with arrow keys and jumps on activation", async () => {
    renderSettings();
    const nav = await screen.findByRole("navigation", { name: "Settings sections" });
    const accounts = within(nav).getByRole("button", { name: "Accounts" });
    accounts.focus();
    fireEvent.keyDown(accounts, { key: "ArrowDown" });
    const appearance = within(nav).getByRole("button", { name: "Appearance & keyboard" });
    expect(document.activeElement).toBe(appearance);
    fireEvent.keyDown(appearance, { key: "End" });
    const advanced = within(nav).getByRole("button", { name: "Advanced" });
    expect(document.activeElement).toBe(advanced);

    fireEvent.click(advanced);
    expect(document.activeElement).toBe(screen.getByRole("region", { name: "Advanced" }));
    expect(advanced.getAttribute("aria-current")).toBe("true");
  });
});
