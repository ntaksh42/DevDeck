import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { WorkItemFieldOption } from "@/lib/azdoCommands";
import { WiFieldColumnsSection } from "./WiFieldColumnsSection";

const listWorkItemFields = vi.fn();

vi.mock("@/lib/azdoCommands", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/azdoCommands")>();
  return {
    ...actual,
    listWorkItemFields: (...args: unknown[]) => listWorkItemFields(...args),
  };
});

afterEach(() => {
  cleanup();
  listWorkItemFields.mockReset();
});

const FIELDS: WorkItemFieldOption[] = [
  { referenceName: "Microsoft.VSTS.Common.Priority", name: "Priority", fieldType: "integer", custom: false },
  { referenceName: "Microsoft.VSTS.Common.Severity", name: "Severity", fieldType: "string", custom: false },
  { referenceName: "Custom.Team", name: "Team", fieldType: "string", custom: true },
];

function renderSection(extraColumns: string[], onChange = vi.fn()) {
  listWorkItemFields.mockResolvedValue(FIELDS);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <WiFieldColumnsSection
        organizationId="contoso"
        projectId="demo"
        extraColumns={extraColumns}
        onExtraColumnsChange={onChange}
      />
    </QueryClientProvider>,
  );
  return onChange;
}

describe("WiFieldColumnsSection", () => {
  it("narrows the field list by search and adds the first match on Enter", async () => {
    const onChange = renderSection([]);
    const search = screen.getByLabelText("Search fields to add as columns");

    fireEvent.change(search, { target: { value: "prio" } });
    expect(await screen.findByRole("button", { name: /Priority/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Severity/ })).toBeNull();

    fireEvent.keyDown(search, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith(["Microsoft.VSTS.Common.Priority"]);
  });

  it("hides fields already shown and removes a column when unchecked", async () => {
    const onChange = renderSection(["Custom.Team"]);
    const checkbox = await screen.findByLabelText("Remove column Custom.Team");
    expect(screen.getByText("Team")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Search fields to add as columns"), {
      target: { value: "team" },
    });
    expect(await screen.findByText("No matching fields")).toBeTruthy();

    fireEvent.click(checkbox);
    expect(onChange).toHaveBeenCalledWith([]);
  });
});
