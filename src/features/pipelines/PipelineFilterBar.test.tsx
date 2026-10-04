import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PipelineFilterBar } from "./PipelineFilterBar";
import { NO_RUN_FILTERS } from "./pipelineBoard";

afterEach(cleanup);

describe("PipelineFilterBar", () => {
  it("stays folded behind the Ctrl+F button until opened, then edits the filters", () => {
    const onChange = vi.fn();
    render(<PipelineFilterBar filters={NO_RUN_FILTERS} onChange={onChange} />);

    expect(screen.queryByRole("textbox", { name: "Filter runs by branch" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Filter runs" }));

    const branch = screen.getByRole("textbox", { name: "Filter runs by branch" });
    expect(document.activeElement).toBe(branch);
    fireEvent.change(branch, { target: { value: "main" } });
    expect(onChange).toHaveBeenCalledWith({ ...NO_RUN_FILTERS, branch: "main" });

    fireEvent.change(screen.getByLabelText("Filter runs by result"), { target: { value: "failed" } });
    expect(onChange).toHaveBeenCalledWith({ ...NO_RUN_FILTERS, result: "failed" });

    fireEvent.click(screen.getByRole("checkbox", { name: "My runs" }));
    expect(onChange).toHaveBeenCalledWith({ ...NO_RUN_FILTERS, requestedForMe: true });
  });

  it("keeps active filters visible as clearable chips while folded", () => {
    const onChange = vi.fn();
    render(
      <PipelineFilterBar
        filters={{ branch: "main", result: "failed", requestedForMe: true }}
        onChange={onChange}
      />,
    );

    expect(screen.getByText("branch: main")).toBeTruthy();
    expect(screen.getByText("result: Failed")).toBeTruthy();
    expect(screen.getByText("My runs")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Clear result: Failed" }));
    expect(onChange).toHaveBeenCalledWith({ branch: "main", result: "", requestedForMe: true });
  });
});
