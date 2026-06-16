import { afterEach, describe, expect, it, vi } from "vitest";
import {
  addSubscription,
  isSubscribed,
  loadPipelineSubscriptions,
  type PipelineSubscription,
  removeSubscription,
  savePipelineSubscriptions,
} from "./pipelineSubscriptionsStorage";

const isTauriRuntime = vi.hoisted(() => vi.fn(() => false));
vi.mock("@/lib/runtime", () => ({ isTauriRuntime }));

const KEY = "azdodeck:pipelineSubscriptions";

function sub(definitionId: number, name = `Pipeline ${definitionId}`): PipelineSubscription {
  return {
    organizationId: "org-1",
    projectId: "proj-1",
    projectName: "Proj 1",
    definitionId,
    definitionName: name,
  };
}

afterEach(() => {
  window.localStorage.clear();
  isTauriRuntime.mockReturnValue(false);
});

describe("pipelineSubscriptionsStorage", () => {
  it("returns an empty list when nothing is stored in the desktop runtime", () => {
    isTauriRuntime.mockReturnValue(true);
    expect(loadPipelineSubscriptions()).toEqual([]);
  });

  it("seeds demo subscriptions when nothing is stored in the browser runtime", () => {
    const seeded = loadPipelineSubscriptions();
    expect(seeded).toHaveLength(2);
    expect(isSubscribed(seeded, "contoso", "demo-project", 1)).toBe(true);
    expect(isSubscribed(seeded, "contoso", "demo-project", 2)).toBe(true);
  });

  it("respects an explicitly saved empty list in the browser runtime", () => {
    savePipelineSubscriptions([]);
    expect(loadPipelineSubscriptions()).toEqual([]);
  });

  it("round-trips saved subscriptions", () => {
    savePipelineSubscriptions([sub(1), sub(2)]);
    expect(loadPipelineSubscriptions()).toEqual([sub(1), sub(2)]);
  });

  it("drops malformed entries and deduplicates on load", () => {
    window.localStorage.setItem(
      KEY,
      JSON.stringify([
        sub(1),
        sub(1), // duplicate
        { organizationId: "org-1", projectId: "proj-1" }, // missing fields
        { ...sub(2), definitionId: "nope" }, // non-numeric id
      ]),
    );
    expect(loadPipelineSubscriptions()).toEqual([sub(1)]);
  });

  it("treats different definitions as distinct subscriptions", () => {
    let list = addSubscription([], sub(1));
    list = addSubscription(list, sub(2));
    expect(list).toHaveLength(2);
    expect(isSubscribed(list, "org-1", "proj-1", 1)).toBe(true);
    expect(isSubscribed(list, "org-1", "proj-1", 2)).toBe(true);
    expect(isSubscribed(list, "org-1", "proj-1", 3)).toBe(false);
  });

  it("does not add a duplicate subscription", () => {
    const once = addSubscription([], sub(1));
    const twice = addSubscription(once, sub(1));
    expect(twice).toBe(once);
  });

  it("removes a subscription by identity", () => {
    let list = addSubscription([], sub(1));
    list = addSubscription(list, sub(2));
    const after = removeSubscription(list, "org-1", "proj-1", 1);
    expect(after).toHaveLength(1);
    expect(isSubscribed(after, "org-1", "proj-1", 1)).toBe(false);
    expect(isSubscribed(after, "org-1", "proj-1", 2)).toBe(true);
  });
});
