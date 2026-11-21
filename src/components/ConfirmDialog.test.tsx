import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { ConfirmDialog } from "./ConfirmDialog";

afterEach(cleanup);

function Harness({ onConfirm = vi.fn() }: { onConfirm?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Complete
      </button>
      {open ? (
        <ConfirmDialog
          title="Complete (merge)"
          message="Merge?"
          onConfirm={onConfirm}
          onCancel={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

function openDialog() {
  render(
    <StrictMode>
      <Harness />
    </StrictMode>,
  );
  const opener = screen.getByRole("button", { name: "Complete" });
  opener.focus();
  fireEvent.click(opener);
  return opener;
}

describe("ConfirmDialog focus handling", () => {
  it("focuses the cancel button on open (also under StrictMode)", async () => {
    openDialog();
    const cancel = await screen.findByRole("button", { name: "Cancel" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(document.activeElement).toBe(cancel);
  });

  it("traps Tab and Shift+Tab inside the dialog", async () => {
    openDialog();
    const cancel = await screen.findByRole("button", { name: "Cancel" });
    const confirm = screen.getByRole("button", { name: "Confirm" });

    confirm.focus();
    fireEvent.keyDown(confirm, { key: "Tab" });
    expect(document.activeElement).toBe(cancel);

    fireEvent.keyDown(cancel, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(confirm);
  });

  it("returns focus to the opener after Escape", async () => {
    const opener = openDialog();
    await screen.findByRole("alertdialog");
    fireEvent.keyDown(document.body, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });
});
