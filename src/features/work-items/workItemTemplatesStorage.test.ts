import { beforeEach, describe, expect, it } from "vitest";
import {
  defaultWorkItemTemplate,
  loadWorkItemTemplates,
  normalizeWorkItemTemplate,
  saveWorkItemTemplates,
  templateFields,
  type WorkItemTemplate,
} from "./workItemTemplatesStorage";

const baseTemplate = {
  id: "wi-tmpl-1",
  name: "Sprint Bug",
  workItemType: "Bug",
};

describe("normalizeWorkItemTemplate", () => {
  it("keeps valid optional fields and clamps priority", () => {
    const template = normalizeWorkItemTemplate({
      ...baseTemplate,
      priority: 9,
      areaPath: "Contoso\\Web",
      iteration: "Sprint 1",
      tags: ["regression", "ui"],
    });
    expect(template).toEqual({
      id: "wi-tmpl-1",
      name: "Sprint Bug",
      isDefault: false,
      workItemType: "Bug",
      title: undefined,
      priority: 4,
      areaPath: "Contoso\\Web",
      iteration: "Sprint 1",
      tags: ["regression", "ui"],
    });
  });

  it("drops invalid priority and blank optional strings", () => {
    const template = normalizeWorkItemTemplate({
      ...baseTemplate,
      priority: "not-a-number",
      areaPath: "   ",
    });
    expect(template?.priority).toBeUndefined();
    expect(template?.areaPath).toBeUndefined();
  });

  it("dedupes tags case-insensitively and trims", () => {
    const template = normalizeWorkItemTemplate({
      ...baseTemplate,
      tags: [" Bug ", "bug", "UI", "ui", ""],
    });
    expect(template?.tags).toEqual(["Bug", "UI"]);
  });

  it("rejects templates missing a name or work item type", () => {
    expect(normalizeWorkItemTemplate({ ...baseTemplate, name: "  " })).toBeNull();
    expect(normalizeWorkItemTemplate({ ...baseTemplate, workItemType: "" })).toBeNull();
    expect(normalizeWorkItemTemplate({ id: "x", name: "y" })).toBeNull();
  });
});

describe("templates storage", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("returns an empty list when nothing is stored", () => {
    expect(loadWorkItemTemplates()).toEqual([]);
  });

  it("round-trips saved templates", () => {
    const templates: WorkItemTemplate[] = [
      { id: "a", name: "Bug", workItemType: "Bug", tags: ["x"] },
    ];
    saveWorkItemTemplates(templates);
    const loaded = loadWorkItemTemplates();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].name).toBe("Bug");
    expect(loaded[0].tags).toEqual(["x"]);
  });

  it("drops corrupt entries on load", () => {
    window.localStorage.setItem(
      "azdodeck:workItemTemplates",
      JSON.stringify([{ id: "a", name: "ok", workItemType: "Task" }, { junk: true }]),
    );
    const loaded = loadWorkItemTemplates();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].name).toBe("ok");
  });

  it("keeps at most one default template", () => {
    saveWorkItemTemplates([
      { id: "a", name: "A", workItemType: "Bug", isDefault: true },
      { id: "b", name: "B", workItemType: "Task", isDefault: true },
    ]);
    const loaded = loadWorkItemTemplates();
    expect(loaded.filter((t) => t.isDefault)).toHaveLength(1);
    expect(defaultWorkItemTemplate(loaded)?.id).toBe("b");
  });
});

describe("templateFields", () => {
  it("projects template values, defaulting tags to an array", () => {
    expect(
      templateFields({ id: "a", name: "A", workItemType: "Bug", priority: 2 }),
    ).toEqual({
      workItemType: "Bug",
      title: undefined,
      priority: 2,
      areaPath: undefined,
      iteration: undefined,
      tags: [],
    });
  });
});
