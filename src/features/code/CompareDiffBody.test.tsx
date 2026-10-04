import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { CompareDiffBody } from "./CompareDiffBody";

afterEach(cleanup);

const base = "one\ntwo\nthree\n";
const target = "one\nTWO\nthree\n";

function renderBody(props: Partial<Parameters<typeof CompareDiffBody>[0]> = {}) {
  return render(
    <CompareDiffBody
      base={base}
      target={target}
      mode="unified"
      ignoreWhitespace={false}
      wrap={false}
      baseLabel="main"
      targetLabel="feature"
      {...props}
    />,
  );
}

describe("CompareDiffBody", () => {
  it("renders unified rows with +/- markers", () => {
    const { container } = renderBody();
    expect(container.textContent).toContain("- two");
    expect(container.textContent).toContain("+ TWO");
    expect(container.querySelectorAll(".grid-cols-2")).toHaveLength(0);
  });

  it("renders two columns in side-by-side mode", () => {
    const { container } = renderBody({ mode: "split" });
    expect(container.querySelectorAll(".grid-cols-2").length).toBeGreaterThan(0);
    expect(container.textContent).toContain("two");
    expect(container.textContent).toContain("TWO");
  });

  it("explains an empty diff, and says so when whitespace is ignored", () => {
    renderBody({ base: "a\n  b\n", target: "a\nb\n", ignoreWhitespace: true });
    expect(
      screen.getByText("No differences between main and feature (ignoring whitespace)."),
    ).toBeTruthy();
  });

  it("wraps long lines only when asked", () => {
    const long = "x".repeat(300);
    const wrapped = renderBody({ base: "a\n", target: `a\n${long}\n`, wrap: true });
    expect(wrapped.container.querySelector(".whitespace-pre-wrap")).not.toBeNull();
    cleanup();
    const plain = renderBody({ base: "a\n", target: `a\n${long}\n`, wrap: false });
    expect(plain.container.querySelector(".whitespace-pre-wrap")).toBeNull();
  });
});
