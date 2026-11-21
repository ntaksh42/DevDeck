import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { getAppSettings } from "@/lib/azdoCommands";
import { ShowWindowHotkeySettings } from "./ShowWindowHotkeySettings";

afterEach(cleanup);

describe("ShowWindowHotkeySettings", () => {
  it("records the digit, not the shifted character", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(["appSettings"], await getAppSettings());
    render(
      <QueryClientProvider client={client}>
        <ShowWindowHotkeySettings />
      </QueryClientProvider>,
    );
    const input = screen.getByLabelText("Show window hotkey") as HTMLInputElement;
    fireEvent.keyDown(input, { key: "!", code: "Digit1", ctrlKey: true, shiftKey: true });
    expect(input.value).toBe("Ctrl+Shift+1");
  });
});
