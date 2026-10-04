import { afterEach, describe, expect, it } from "vitest";
import { loadQueueRecent, saveQueueRecent } from "./pipelineQueueRecent";

afterEach(() => window.localStorage.clear());

describe("pipelineQueueRecent", () => {
  it("returns null when nothing was saved", () => {
    expect(loadQueueRecent("o", "p", 1)).toBeNull();
  });

  it("round-trips the branch and variables per pipeline", () => {
    saveQueueRecent("o", "p", 1, { branch: "release/1", variables: { env: "prod" } });
    saveQueueRecent("o", "p", 2, { branch: "main", variables: {} });
    expect(loadQueueRecent("o", "p", 1)).toEqual({ branch: "release/1", variables: { env: "prod" } });
    expect(loadQueueRecent("o", "p", 2)?.branch).toBe("main");
  });

  it("survives corrupted storage", () => {
    window.localStorage.setItem("azdodeck:pipelines:queueRecent:v1", "{not json");
    expect(loadQueueRecent("o", "p", 1)).toBeNull();
  });
});
