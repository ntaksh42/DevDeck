import { describe, expect, it } from "vitest";

import { customPreviewFieldsSignature, workItemQueryKeys } from "./queryKeys";

describe("customPreviewFieldsSignature", () => {
  // Regression: WorkItemBoard joined the reference names on "," while
  // WorkItemPreviewPanel and useWiGridLogic joined on "|". The panel's
  // mutations wrote the preview under one key and the board read another, so
  // applying an edit on the board left the stale values on screen. All three
  // call sites now derive the signature here.
  it("keeps every preview call site on one cache entry", () => {
    const refs = ["Custom.Team", "Custom.Severity"];

    const writtenByPreviewPanel = workItemQueryKeys.preview(
      "org",
      "proj",
      42,
      customPreviewFieldsSignature(refs),
    );
    const readByBoard = workItemQueryKeys.preview(
      "org",
      "proj",
      42,
      customPreviewFieldsSignature(refs),
    );

    expect(readByBoard).toEqual(writtenByPreviewPanel);
    expect(readByBoard).not.toEqual(
      workItemQueryKeys.preview("org", "proj", 42, refs.join(",")),
    );
  });

  it("separates field sets that differ only in order", () => {
    expect(customPreviewFieldsSignature(["a", "b"])).not.toBe(
      customPreviewFieldsSignature(["b", "a"]),
    );
  });

  it("returns an empty signature when no custom fields are configured", () => {
    expect(customPreviewFieldsSignature([])).toBe("");
  });
});
