import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentResultPanel } from "./AgentResultPanel";

vi.mock("@/lib/azdoCommands", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/azdoCommands")>(),
  getAppSettings: vi.fn(async () => ({ agentCommand: null })),
  listAgentNotes: vi.fn(async () => []),
}));
const openLocalPath = vi.fn(async (_path: string) => {});
vi.mock("@/lib/openExternal", () => ({ openLocalPath: (path: string) => openLocalPath(path) }));

afterEach(() => {
  cleanup();
  openLocalPath.mockClear();
});

function renderPanel(tooLarge: boolean, warning: string | null = null) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AgentResultPanel
        item={{ target: "pull-request", itemId: 42 }}
        hasFolder loading={false} error={null}
        preview={{ fileName: "PR42.html", filePath: "C:/reports/PR42.html", html: tooLarge ? "" : "<p>日本語</p>", tooLarge, warning }}
        frameTitle="Result" noFolderMessage="No folder" noMatchMessage="No file"
      />
    </QueryClientProvider>,
  );
}

describe("AgentResultPanel HTML limits", () => {
  it("shows a decoding warning alongside the preview", () => {
    const { container } = renderPanel(false, "文字コードを判別できませんでした");
    expect(screen.getByRole("status").textContent).toContain("文字コードを判別できませんでした");
    expect(container.querySelector("iframe")?.getAttribute("srcdoc")).toContain("日本語");
  });

  it("omits the iframe for large HTML and opens its path from the button or o key", async () => {
    const { container } = renderPanel(true);
    expect(screen.getByText(/ファイルが大きすぎます/)).toBeTruthy();
    expect(container.querySelector("iframe")).toBeNull();
    const button = screen.getByRole("button", { name: "外部ブラウザで開く (o)" });
    button.focus();
    expect(document.activeElement).toBe(button);
    fireEvent.click(button);
    await waitFor(() => expect(openLocalPath).toHaveBeenCalledWith("C:/reports/PR42.html"));
    fireEvent.keyDown(button, { key: "o" });
    expect(openLocalPath).toHaveBeenCalledTimes(2);
  });
});
