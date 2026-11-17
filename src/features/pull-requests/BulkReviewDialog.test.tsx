import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { BulkReviewDialog } from "./BulkReviewDialog";

afterEach(cleanup);

describe("BulkReviewDialog", () => {
  it("leaves Escape that cancels an IME conversion to the IME", () => {
    const onCancel = vi.fn();
    render(<BulkReviewDialog titles={["!1 Fix"]} onConfirm={vi.fn()} onCancel={onCancel} />);
    const note = screen.getByRole("textbox");
    fireEvent.keyDown(note, { key: "Escape", isComposing: true });
    expect(onCancel).not.toHaveBeenCalled();
    fireEvent.keyDown(note, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
