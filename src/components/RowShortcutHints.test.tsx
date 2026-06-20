import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { RowShortcutHints } from "./RowShortcutHints";

afterEach(cleanup);

describe("RowShortcutHints", () => {
  it("renders each shortcut key and label", () => {
    render(
      <RowShortcutHints
        hints={[
          { keys: "A", label: "Approve" },
          { keys: "X", label: "Reject" },
        ]}
      />,
    );
    expect(screen.getByText("A")).toBeTruthy();
    expect(screen.getByText("Approve")).toBeTruthy();
    expect(screen.getByText("X")).toBeTruthy();
    expect(screen.getByLabelText("Shortcuts for the selected row")).toBeTruthy();
  });

  it("renders nothing for an empty list", () => {
    const { container } = render(<RowShortcutHints hints={[]} />);
    expect(container.firstChild).toBeNull();
  });
});
