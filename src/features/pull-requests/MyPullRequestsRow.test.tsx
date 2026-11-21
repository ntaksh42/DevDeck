import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { demoMyCreatedPullRequests } from "@/lib/demo/prData";
import { renderCell } from "./MyPullRequestsRow";

afterEach(cleanup);

describe("Ready to merge badge", () => {
  it("shows only for ready, non-draft PRs", () => {
    const pr = demoMyCreatedPullRequests()[0];
    const { rerender } = render(<>{renderCell("title", { ...pr, readyToMerge: true })}</>);
    expect(screen.getByText("Ready to merge")).toBeTruthy();
    rerender(<>{renderCell("title", { ...pr, readyToMerge: false })}</>);
    expect(screen.queryByText("Ready to merge")).toBeNull();
    rerender(<>{renderCell("title", { ...pr, readyToMerge: true, isDraft: true })}</>);
    expect(screen.queryByText("Ready to merge")).toBeNull();
    expect(screen.getByText("Draft")).toBeTruthy();
  });
});
