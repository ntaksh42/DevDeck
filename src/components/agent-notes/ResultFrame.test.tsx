import { createRef } from "react";
import { act, fireEvent, render } from "@testing-library/react";
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

  it("clamps a block selection anchor left over from a longer previous result", () => {
    const frameRef = createRef<HTMLIFrameElement>();
    const noop = () => {};
    const props = {
      html: "<p>result</p>",
      title: "Result",
      frameRef,
      onFrameLoad: noop,
      anchors: [],
      activeId: null,
      pendingRange: null,
      onComment: noop,
      onRevealNote: noop,
      onOpenNote: noop,
    };
    const { container, rerender } = render(<ResultFrame {...props} frame={null} />);
    const doc = frameRef.current!.contentDocument!;
    // jsdom has no CSS Custom Highlight API; stub it so the paint effect runs.
    const win = frameRef.current!.contentWindow as unknown as Record<string, unknown>;
    win.CSS = { highlights: new Map() };
    win.Highlight = class {
      priority = 0;
    };
    (win.HTMLElement as typeof HTMLElement).prototype.scrollIntoView = () => {};
    doc.body.innerHTML = "<p>1</p><p>2</p><p>3</p><p>4</p><p>5</p>";
    const longFrame: FrameState = {
      doc,
      index: { text: "", map: [] },
      blocks: [...doc.body.querySelectorAll<HTMLElement>("p")],
    };
    rerender(<ResultFrame {...props} frame={longFrame} />);
    const wrap = container.querySelector<HTMLElement>("[data-agent-result-frame='true']")!;
    act(() => wrap.focus());
    // Cursor to the last block, then extend back: the anchor stays on block 5.
    fireEvent.keyDown(wrap, { key: "End" });
    fireEvent.keyDown(wrap, { key: "Home", shiftKey: true });

    // The result is replaced by a one-block document while comment mode is on.
    doc.body.innerHTML = "<p>only</p>";
    const shortFrame: FrameState = {
      doc,
      index: { text: "", map: [] },
      blocks: [...doc.body.querySelectorAll<HTMLElement>("p")],
    };
    expect(() => rerender(<ResultFrame {...props} frame={shortFrame} />)).not.toThrow();
  });
});
