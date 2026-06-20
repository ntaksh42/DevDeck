import { afterEach, describe, expect, it, vi } from "vitest";
import {
  addQuickPipeline,
  loadQuickPipelines,
  type QuickPipelineDraft,
  removeQuickPipeline,
  saveQuickPipelines,
} from "./quickPipelinesStorage";

const isTauriRuntime = vi.hoisted(() => vi.fn(() => false));
vi.mock("@/lib/runtime", () => ({ isTauriRuntime }));

const KEY = "azdodeck:quickPipelines";

function draft(overrides: Partial<QuickPipelineDraft> = {}): QuickPipelineDraft {
  return {
    name: "Deploy Staging",
    organizationId: "org-1",
    projectId: "proj-1",
    projectName: "Proj 1",
    definitionId: 42,
    definitionName: "Deploy",
    sourceBranch: "refs/heads/main",
    ...overrides,
  };
}

afterEach(() => {
  window.localStorage.clear();
  isTauriRuntime.mockReturnValue(false);
});

describe("quickPipelinesStorage", () => {
  it("returns an empty list in the desktop runtime when nothing is stored", () => {
    isTauriRuntime.mockReturnValue(true);
    expect(loadQuickPipelines()).toEqual([]);
  });

  it("seeds demo pipelines in the browser runtime when nothing is stored", () => {
    const seeded = loadQuickPipelines();
    expect(seeded).toHaveLength(1);
    expect(seeded[0].name).toBe("Run CI (main)");
  });

  it("adds and persists a pipeline with a generated id", () => {
    const added = addQuickPipeline([], draft());
    expect(added).toHaveLength(1);
    expect(added[0].id).toBeTruthy();
    expect(added[0].name).toBe("Deploy Staging");
    saveQuickPipelines(added);
    expect(loadQuickPipelines()).toHaveLength(1);
  });

  it("trims the display name when adding", () => {
    const added = addQuickPipeline([], draft({ name: "  Nightly  " }));
    expect(added[0].name).toBe("Nightly");
  });

  it("removes a pipeline by id", () => {
    const added = addQuickPipeline([], draft());
    const next = removeQuickPipeline(added, added[0].id);
    expect(next).toEqual([]);
  });

  it("drops invalid entries when loading", () => {
    window.localStorage.setItem(
      KEY,
      JSON.stringify([
        draft(),
        { name: "", organizationId: "org-1" },
        { ...draft(), sourceBranch: "" },
      ]),
    );
    expect(loadQuickPipelines()).toHaveLength(1);
  });

  it("returns an empty list when stored JSON is corrupt", () => {
    window.localStorage.setItem(KEY, "{not json");
    expect(loadQuickPipelines()).toEqual([]);
  });
});
