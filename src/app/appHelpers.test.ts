import { describe, expect, it } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { invalidateSyncedDataQueries } from "./appHelpers";

function seededClient(): QueryClient {
  const client = new QueryClient();
  client.setQueryData(["snoozedItems", "pull_request", "org"], []);
  client.setQueryData(["snoozedItems", "work_item", "org"], []);
  return client;
}

function isStale(client: QueryClient, key: unknown[]): boolean {
  return client.getQueryState(key)?.isInvalidated ?? false;
}

describe("invalidateSyncedDataQueries", () => {
  it("refreshes snoozed items revived by a review or work item sync", () => {
    const client = seededClient();
    invalidateSyncedDataQueries(client, ["myWorkItems"]);
    expect(isStale(client, ["snoozedItems", "work_item", "org"])).toBe(true);
    expect(isStale(client, ["snoozedItems", "pull_request", "org"])).toBe(false);

    invalidateSyncedDataQueries(client, ["myReviews"]);
    expect(isStale(client, ["snoozedItems", "pull_request", "org"])).toBe(true);
  });

  it("leaves snoozed items alone for a commit-only sync", () => {
    const client = seededClient();
    invalidateSyncedDataQueries(client, ["commits"]);
    expect(isStale(client, ["snoozedItems", "work_item", "org"])).toBe(false);
    expect(isStale(client, ["snoozedItems", "pull_request", "org"])).toBe(false);
  });
});
