import { describe, expect, it } from "vitest";
import { currentViewSyncScope } from "./useSyncManager";

describe("currentViewSyncScope", () => {
  it("refreshes the data the view shows", () => {
    expect(currentViewSyncScope("myReviews")).toBe("myReviews");
    expect(currentViewSyncScope("myWorkItems")).toBe("myWorkItems");
    // Inbox rows come from both the pull request and the work item sync.
    expect(currentViewSyncScope("inbox")).toBe("all");
    expect(currentViewSyncScope("autoQueue")).toBe("all");
    expect(currentViewSyncScope("crossOrgSummary")).toBe("all");
  });
});
