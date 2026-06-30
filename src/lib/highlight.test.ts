import { describe, expect, it } from "vitest";
import { highlightCode } from "./highlight";

describe("highlightCode language resolution", () => {
  it("resolves languages that highlight.js/lib/common does not register by default", () => {
    expect(highlightCode("FROM node:20\nRUN echo hi", "Dockerfile").language).toBe("dockerfile");
    expect(highlightCode("$x = 1\nWrite-Host $x", "script.ps1").language).toBe("powershell");
    expect(highlightCode("object Main extends App", "Main.scala").language).toBe("scala");
  });

  it("resolves newly mapped extensions to their registered language", () => {
    expect(highlightCode("local x = 1", "init.lua").language).toBe("lua");
    expect(highlightCode("my $x = 1;", "script.pl").language).toBe("perl");
    expect(highlightCode("x <- 1", "analysis.r").language).toBe("r");
    expect(highlightCode("Sub Main()\nEnd Sub", "Module1.vb").language).toBe("vbnet");
    expect(highlightCode("query { field }", "schema.graphql").language).toBe("graphql");
    expect(highlightCode("--- a\n+++ b", "change.diff").language).toBe("diff");
    expect(highlightCode("build:\n\tgo build", "Makefile").language).toBe("makefile");
  });

  it("falls back to auto-detection for unmapped extensions without throwing", () => {
    const result = highlightCode("plain text content", "notes.unknownext");
    expect(typeof result.html).toBe("string");
  });
});
