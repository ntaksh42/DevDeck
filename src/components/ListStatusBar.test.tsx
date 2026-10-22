import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { OPEN_HELP_EVENT } from "@/lib/helpEvents";
import { HelpDialog } from "./HelpDialog";
import { itemCount, ListStatusBar } from "./ListStatusBar";

afterEach(cleanup);

describe("ListStatusBar", () => {
  it("joins the summary with a middle dot and skips empty parts", () => {
    render(<ListStatusBar summary={["6 items", null, "2 not voted", false, "3 changed files"]} />);
    expect(screen.getByText("6 items · 2 not voted · 3 changed files")).toBeTruthy();
  });

  it("orders the buttons Done, Snoozed, Stale, Fit, Columns, ? and omits missing ones", () => {
    render(
      <ListStatusBar
        summary={[itemCount(5)]}
        done={{ count: 2, active: false, onToggle: () => undefined }}
        snoozed={{ count: 0, active: true, onToggle: () => undefined }}
        stale={{ count: 3, active: false, onToggle: () => undefined, thresholdDays: 14 }}
        fitWidths={{ auto: true, onFit: () => undefined }}
        onColumns={() => undefined}
      />,
    );
    const names = screen.getAllByRole("button").map((button) => button.textContent?.trim());
    expect(names).toEqual(["Done 2", "Snoozed 0", "Stale 3", "Fit", "Columns", "?"]);
    expect(screen.getByRole("button", { name: "Snoozed 0" }).getAttribute("aria-pressed")).toBe("true");

    cleanup();
    render(<ListStatusBar summary={[itemCount(1)]} />);
    expect(screen.getAllByRole("button").map((button) => button.textContent)).toEqual(["?"]);
    expect(screen.getByText("1 item")).toBeTruthy();
  });

  it("re-fits column widths from Fit and frames it only after a manual resize", () => {
    const onFit = vi.fn();
    const { rerender } = render(<ListStatusBar summary={["1 item"]} fitWidths={{ auto: true, onFit }} />);
    const fit = screen.getByRole("button", { name: "Fit" });
    expect(fit.className).toContain("border-transparent");

    fireEvent.click(fit);
    expect(onFit).toHaveBeenCalledTimes(1);

    rerender(<ListStatusBar summary={["1 item"]} fitWidths={{ auto: false, onFit }} />);
    expect(screen.getByRole("button", { name: "Fit" }).className).toContain("border-border");
  });

  it("asks the app to open Help at the view's section from the ? button", () => {
    const listener = vi.fn();
    window.addEventListener(OPEN_HELP_EVENT, listener);
    render(<ListStatusBar summary={["1 item"]} helpSection="inbox" />);

    fireEvent.click(screen.getByRole("button", { name: "Show keyboard shortcuts for this view" }));

    expect(listener).toHaveBeenCalledTimes(1);
    expect((listener.mock.calls[0][0] as CustomEvent).detail).toEqual({ section: "inbox" });
    window.removeEventListener(OPEN_HELP_EVENT, listener);
  });
});

describe("HelpDialog section", () => {
  it("marks the requested view section", () => {
    const { container } = render(<HelpDialog section="pipelines" onClose={() => undefined} />);
    const heading = container.querySelector("[data-help-section='pipelines']");
    expect(heading?.textContent).toBe("Pipelines");
    expect(heading?.className).toContain("text-primary");
    expect(container.querySelector("[data-help-section='inbox']")?.className).not.toContain("text-primary");
  });
});
