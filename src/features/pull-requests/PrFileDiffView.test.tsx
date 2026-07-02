import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { DiffContent } from "./PrFileDiffView";

afterEach(cleanup);

const base = ["line1", "line2", "line3", "line4", "line5"].join("\n") + "\n";
const target = ["line1", "CHANGED2", "line3", "line4", "CHANGED5"].join("\n") + "\n";

const noop = {
  lineAttachments: () => null,
  lineHasContent: () => false,
  onStartComment: () => {},
};

describe("DiffContent hunk-start markers", () => {
  it("marks the first row of each hunk in unified view", () => {
    const { container } = render(
      <DiffContent
        baseContent={base}
        targetContent={target}
        baseUnavailableReason={null}
        targetUnavailableReason={null}
        webUrl={null}
        viewMode="unified"
        wholeFile
        {...noop}
      />,
    );
    const marks = container.querySelectorAll("[data-hunk-start]");
    // Two separate edited lines (line2, line5) => two hunks.
    expect(marks).toHaveLength(2);
  });

  it("marks the first row of each hunk in split view", () => {
    const { container } = render(
      <DiffContent
        baseContent={base}
        targetContent={target}
        baseUnavailableReason={null}
        targetUnavailableReason={null}
        webUrl={null}
        viewMode="split"
        wholeFile
        {...noop}
      />,
    );
    const marks = container.querySelectorAll("[data-hunk-start]");
    expect(marks).toHaveLength(2);
  });

  it("does not mark unchanged context rows", () => {
    const { container } = render(
      <DiffContent
        baseContent={base}
        targetContent={base}
        baseUnavailableReason={null}
        targetUnavailableReason={null}
        webUrl={null}
        viewMode="unified"
        wholeFile
        {...noop}
      />,
    );
    expect(container.querySelectorAll("[data-hunk-start]")).toHaveLength(0);
  });
});
