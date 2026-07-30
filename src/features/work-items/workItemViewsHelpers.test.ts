import { describe, expect, it } from "vitest";
import { formatWiql, tokenizeWiql } from "./workItemViewsHelpers";

describe("tokenizeWiql", () => {
  it("reproduces the input exactly when the tokens are concatenated", () => {
    const wiql = "SELECT [System.Id]\nFROM WorkItems\nWHERE [System.State] = 'Active'";
    expect(tokenizeWiql(wiql).map((token) => token.text).join("")).toBe(wiql);
  });

  it("classifies keywords, fields, macros, strings and numbers", () => {
    const tokens = tokenizeWiql(
      "SELECT [System.Id] FROM WorkItems WHERE [System.AssignedTo] = @Me AND [Priority] <= 2 AND [State] = 'Active'",
    );
    const kindOf = (text: string) => tokens.find((token) => token.text === text)?.kind;
    expect(kindOf("SELECT")).toBe("keyword");
    expect(kindOf("WHERE")).toBe("keyword");
    expect(kindOf("[System.Id]")).toBe("field");
    expect(kindOf("@Me")).toBe("macro");
    expect(kindOf("'Active'")).toBe("string");
    expect(kindOf("2")).toBe("number");
  });

  it("prefers ORDER BY over the OR keyword", () => {
    const tokens = tokenizeWiql("ORDER BY [System.ChangedDate] DESC");
    expect(tokens[0]).toEqual({ text: "ORDER BY", kind: "keyword" });
  });

  it("does not treat keywords inside a bracketed field as separate tokens", () => {
    const tokens = tokenizeWiql("[System.AreaPath] UNDER 'Team\\In Progress'");
    expect(tokens.some((token) => token.text === "[System.AreaPath]" && token.kind === "field")).toBe(
      true,
    );
    expect(
      tokens.some((token) => token.text === "'Team\\In Progress'" && token.kind === "string"),
    ).toBe(true);
  });

  it("returns no tokens for an empty query", () => {
    expect(tokenizeWiql("")).toEqual([]);
  });
});

describe("formatWiql", () => {
  it("puts each clause on its own line and indents boolean connectors", () => {
    const formatted = formatWiql(
      "SELECT [System.Id] FROM WorkItems WHERE [System.State] = 'Active' AND [Microsoft.VSTS.Common.Priority] <= 2 ORDER BY [System.ChangedDate] DESC",
    );
    expect(formatted).toBe(
      [
        "SELECT [System.Id]",
        "FROM WorkItems",
        "WHERE [System.State] = 'Active'",
        "  AND [Microsoft.VSTS.Common.Priority] <= 2",
        "ORDER BY [System.ChangedDate] DESC",
      ].join("\n"),
    );
  });

  it("uppercases clause keywords that were typed in lower case", () => {
    expect(formatWiql("select [System.Id] from WorkItems where [System.Id] = 1")).toBe(
      ["SELECT [System.Id]", "FROM WorkItems", "WHERE [System.Id] = 1"].join("\n"),
    );
  });

  it("collapses the multi-space form of ORDER BY into one keyword", () => {
    expect(formatWiql("SELECT [System.Id] FROM WorkItems order   by [System.Id] ASC")).toBe(
      ["SELECT [System.Id]", "FROM WorkItems", "ORDER BY [System.Id] ASC"].join("\n"),
    );
  });

  it("keeps keywords that appear inside a quoted value intact", () => {
    const formatted = formatWiql(
      "SELECT [System.Id] FROM WorkItems WHERE [System.State] = 'To Do And Review'",
    );
    expect(formatted).toBe(
      ["SELECT [System.Id]", "FROM WorkItems", "WHERE [System.State] = 'To Do And Review'"].join(
        "\n",
      ),
    );
  });

  it("keeps a field reference containing a keyword intact", () => {
    const formatted = formatWiql("SELECT [Custom.OrderIndex] FROM WorkItems");
    expect(formatted).toBe(["SELECT [Custom.OrderIndex]", "FROM WorkItems"].join("\n"));
  });

  it("is idempotent, so formatting an already formatted query changes nothing", () => {
    const source =
      "SELECT [System.Id] FROM WorkItems WHERE [System.State] = 'Active' AND [System.Id] > 10 ORDER BY [System.Id] DESC";
    const once = formatWiql(source);
    expect(formatWiql(once)).toBe(once);
  });

  it("returns an empty string for a blank query", () => {
    expect(formatWiql("   \n  ")).toBe("");
  });
});
