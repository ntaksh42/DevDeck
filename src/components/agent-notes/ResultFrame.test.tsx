import { createRef } from "react";
import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ResultFrame } from "./ResultFrame";
import type { FrameState } from "./types";

afterEach(() => {
  vi.useRealTimers();
});

describe("ResultFrame", () => {
  it("ignores a frame state left over from the previous row while the iframe reloads", () => {
    vi.useFakeTimers();
    // `frame` still indexes the previous row's document...
    const staleDoc = document.implementation.createHTMLDocument("previous");
    staleDoc.body.innerHTML = "<p>previous result</p>";
    const frame: FrameState = {
      doc: staleDoc,
      index: { text: "", map: [] },
      blocks: [],
    };
    const frameRef = createRef<HTMLIFrameElement>();
    const noop = () => {};
    render(
      <ResultFrame
        html="<p>next result</p>"
        title="Result"
        frameRef={frameRef}
        frame={frame}
        onFrameLoad={noop}
        anchors={[]}
        activeId={null}
        pendingRange={null}
        onComment={noop}
        onRevealNote={noop}
        onOpenNote={noop}
      />,
    );
    // ...while the iframe is mid-navigation to the next row's result, whose
    // document has no root element yet.
    const loadingDoc = frameRef.current!.contentDocument!;
    loadingDoc.removeChild(loadingDoc.documentElement);

    expect(() => {
      act(() => {
        vi.advanceTimersByTime(500);
      });
    }).not.toThrow();
  });
});
