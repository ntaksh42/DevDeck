import { describe, expect, it } from "vitest";
import { detectPipelineTransition } from "./usePipelineWatchNotifications";

describe("detectPipelineTransition", () => {
  it("never notifies on the first observation", () => {
    expect(detectPipelineTransition(undefined, { buildId: 1, inProgress: true })).toBeNull();
    expect(detectPipelineTransition(undefined, { buildId: 1, inProgress: false })).toBeNull();
  });

  it("notifies started when the same run flips to running", () => {
    expect(
      detectPipelineTransition({ buildId: 1, inProgress: false }, { buildId: 1, inProgress: true }),
    ).toBe("started");
  });

  it("notifies finished when the same run completes", () => {
    expect(
      detectPipelineTransition({ buildId: 1, inProgress: true }, { buildId: 1, inProgress: false }),
    ).toBe("finished");
  });

  it("does not re-notify while the run keeps the same state", () => {
    expect(
      detectPipelineTransition({ buildId: 1, inProgress: true }, { buildId: 1, inProgress: true }),
    ).toBeNull();
    expect(
      detectPipelineTransition(
        { buildId: 1, inProgress: false },
        { buildId: 1, inProgress: false },
      ),
    ).toBeNull();
  });

  it("notifies started when a newer run is already running", () => {
    expect(
      detectPipelineTransition({ buildId: 1, inProgress: false }, { buildId: 2, inProgress: true }),
    ).toBe("started");
  });

  it("notifies finished when a newer run already completed between polls", () => {
    expect(
      detectPipelineTransition({ buildId: 1, inProgress: true }, { buildId: 2, inProgress: false }),
    ).toBe("finished");
  });
});
