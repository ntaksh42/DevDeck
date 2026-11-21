import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { PrSearchProgressControls, type PrSearchProgressState } from "./PrSearchProgress";

afterEach(cleanup);
const initial = (): PrSearchProgressState => ({ progressive: true, scannedCount: 200, complete: false, hasMore: true, retryAvailable: false, dirty: false, stopping: false, onContinue: vi.fn(), onRetry: vi.fn(), onStop: vi.fn() });

it("returns focus to the selected row when the final continuation control disappears", () => {
  const progress = initial();
  function View({ complete }: { complete: boolean }) {
    return <><div data-primary-grid="true" tabIndex={-1}><div role="row" tabIndex={0} aria-selected="true">Selected PR</div></div><PrSearchProgressControls progress={{ ...progress, hasMore: !complete, complete }} loading={false} /></>;
  }
  const { rerender } = render(<View complete={false} />);
  const button = screen.getByRole("button", { name: "Search more" });
  button.focus(); fireEvent.click(button);
  rerender(<View complete />);
  expect(document.activeElement).toBe(screen.getByRole("row"));
});

it("uses the empty result pane as the keyboard fallback after retry completion", () => {
  const progress = { ...initial(), hasMore: false, retryAvailable: true };
  function View({ complete }: { complete: boolean }) {
    return <><div data-grid-focus-fallback="true" tabIndex={-1}>Empty results</div><PrSearchProgressControls progress={{ ...progress, retryAvailable: !complete, complete }} loading={false} /></>;
  }
  const { rerender } = render(<View complete={false} />);
  const button = screen.getByRole("button", { name: "Retry failed scopes" });
  button.focus(); fireEvent.click(button);
  rerender(<View complete />);
  expect(document.activeElement?.textContent).toBe("Empty results");
});

it("keeps Stop focus while stopping and ignores repeated activation", () => {
  const progress = initial();
  const { rerender } = render(<PrSearchProgressControls progress={progress} loading />);
  const button = screen.getByRole("button", { name: "Stop" });
  button.focus(); fireEvent.click(button);
  rerender(<PrSearchProgressControls progress={{ ...progress, stopping: true }} loading />);
  fireEvent.click(screen.getByRole("button", { name: "Stopping…" }));
  expect(document.activeElement).toBe(button);
  expect(progress.onStop).toHaveBeenCalledTimes(1);
});
