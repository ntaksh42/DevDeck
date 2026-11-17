import { describe, expect, it } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { invalidateSyncedDataQueries } from "./appHelpers";

describe("invalidateSyncedDataQueries", () => {
  it("refreshes the snoozed lists after a work item sync", () => {
    const client = new QueryClient();
    client.setQueryData(["snoozedItems", "work_item", "org"], []);
    invalidateSyncedDataQueries(client, ["myWorkItems"]);
    expect(client.getQueryState(["snoozedItems", "work_item", "org"])?.isInvalidated).toBe(true);
  });

  it("re-reads the Inbox so items whose snooze ran out come back", () => {
    const client = new QueryClient();
    client.setQueryData(["actionInbox", "list", "open", ""], []);
    invalidateSyncedDataQueries(client, ["myReviews"]);
    expect(client.getQueryState(["actionInbox", "list", "open", ""])?.isInvalidated).toBe(true);
  });
});
