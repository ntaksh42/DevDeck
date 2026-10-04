import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CodeFileActions, UnavailableFileNotice } from "./CodeFileActions";

afterEach(cleanup);

describe("UnavailableFileNotice", () => {
  it("explains why the file is not shown and offers to open it in Azure DevOps", () => {
    const onOpen = vi.fn();
    render(<UnavailableFileNotice message="Binary file not shown." onOpenInBrowser={onOpen} />);

    expect(screen.getByText("Binary file not shown.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open in Azure DevOps" }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});

describe("CodeFileActions", () => {
  const base = {
    wrap: false,
    raw: false,
    copied: false,
    onToggleWrap: () => {},
    onToggleRaw: () => {},
    onDownload: () => {},
    onCopy: () => {},
  };

  it("shows the Rendered button only for Markdown files", () => {
    const { rerender } = render(<CodeFileActions {...base} />);
    expect(screen.queryByRole("button", { name: "Rendered" })).toBeNull();

    const onShowRendered = vi.fn();
    rerender(<CodeFileActions {...base} onShowRendered={onShowRendered} />);
    fireEvent.click(screen.getByRole("button", { name: "Rendered" }));
    expect(onShowRendered).toHaveBeenCalledTimes(1);
  });
});
