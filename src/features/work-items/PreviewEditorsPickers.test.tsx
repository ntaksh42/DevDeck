import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ClassificationPicker } from "./PreviewEditorsPickers";

describe("ClassificationPicker", () => {
  it("shows every segment of the current classification path", () => {
    render(
      <ClassificationPicker
        ariaLabel="Change area path"
        current="Platform\\Product\\Payments\\Reconciliation"
        emptyLabel="No areas available"
        loading={false}
        onOpenChange={vi.fn()}
        onSelect={vi.fn()}
        open={false}
        options={[]}
        pending={false}
      />,
    );

    expect(screen.getByRole("button", { name: "Change area path" }).textContent).toBe(
      "Platform › Product › Payments › Reconciliation",
    );
  });
});
