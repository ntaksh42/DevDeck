import { beforeEach, describe, expect, it, vi } from "vitest";
import { downloadViewsExport } from "./workItemViewsTransfer";

const { isTauriRuntime, save, writeTextFile } = vi.hoisted(() => ({
  isTauriRuntime: vi.fn(),
  save: vi.fn(),
  writeTextFile: vi.fn(),
}));

const createObjectURL = vi.fn(() => "blob:work-item-views");
const revokeObjectURL = vi.fn();
Object.defineProperties(URL, {
  createObjectURL: { configurable: true, value: createObjectURL },
  revokeObjectURL: { configurable: true, value: revokeObjectURL },
});

vi.mock("@/lib/runtime", () => ({ isTauriRuntime }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ save }));
vi.mock("@tauri-apps/plugin-fs", () => ({ writeTextFile }));

const views = [
  {
    id: "wi-view-1",
    name: "Active bugs",
    projectId: "project-1",
    wiql: "SELECT [System.Id] FROM WorkItems",
  },
];

describe("downloadViewsExport", () => {
  beforeEach(() => {
    isTauriRuntime.mockReset().mockReturnValue(true);
    save.mockReset();
    writeTextFile.mockReset();
    createObjectURL.mockClear();
    revokeObjectURL.mockClear();
  });

  it("lets desktop users choose the JSON destination before writing", async () => {
    save.mockResolvedValue("C:\\Exports\\views.json");

    await expect(downloadViewsExport(views)).resolves.toBe("Exported 1 view.");

    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Export work item views",
        filters: [{ name: "JSON", extensions: ["json"] }],
      }),
    );
    expect(writeTextFile).toHaveBeenCalledWith(
      "C:\\Exports\\views.json",
      expect.stringContaining('"schema": "azdodeck.workItemViews"'),
    );
  });

  it("does not write when the desktop save dialog is cancelled", async () => {
    save.mockResolvedValue(null);

    await expect(downloadViewsExport(views)).resolves.toBe("Export cancelled.");
    expect(writeTextFile).not.toHaveBeenCalled();
  });

  it("keeps browser exports on the download path", async () => {
    isTauriRuntime.mockReturnValue(false);
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    await expect(downloadViewsExport(views)).resolves.toBe("Exported 1 view.");

    expect(save).not.toHaveBeenCalled();
    expect(writeTextFile).not.toHaveBeenCalled();
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(click).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:work-item-views");
    click.mockRestore();
  });
});
