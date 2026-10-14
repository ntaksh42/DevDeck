import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { getAppSettings } from "@/lib/azdoCommands";
import { DesktopNotificationSettings } from "./DesktopNotificationSettings";

afterEach(() => {
  cleanup();
});

describe("DesktopNotificationSettings", () => {
  it("keeps an unsaved change when another section saves the settings", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const saved = await getAppSettings();
    client.setQueryData(["appSettings"], saved);
    render(
      <QueryClientProvider client={client}>
        <DesktopNotificationSettings />
      </QueryClientProvider>,
    );
    const assigned = screen.getByRole("checkbox", { name: "Assigned work items" }) as HTMLInputElement;
    const before = assigned.checked;
    fireEvent.click(assigned);

    // Another section saved: only its own field changed.
    await act(async () => {
      client.setQueryData(["appSettings"], { ...saved, agentCommand: "claude -p other" });
      // The query cache notifies its observers on the next tick.
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect((screen.getByRole("checkbox", { name: "Assigned work items" }) as HTMLInputElement).checked).toBe(!before);
  });
});
