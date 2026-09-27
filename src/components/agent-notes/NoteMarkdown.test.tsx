import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { NoteMarkdown } from "./NoteMarkdown";

describe("NoteMarkdown", () => {
  it("renders markdown and links item references outside code", () => {
    const { container } = render(
      <NoteMarkdown text={"See **#123** and !45, not `#9` or a&#1;"} />,
    );
    expect(container.querySelector("strong a")?.getAttribute("data-work-item")).toBe("123");
    expect(container.querySelector("a[data-pull-request]")?.textContent).toBe("!45");
    expect(container.querySelector("code")?.textContent).toBe("#9");
    expect(container.querySelectorAll("a")).toHaveLength(2);
  });
});
