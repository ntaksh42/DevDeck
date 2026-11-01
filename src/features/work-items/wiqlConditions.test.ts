import { describe, expect, it } from 'vitest';
import {
  operatorsForFieldType,
  parseWiqlConditions,
  replaceWiqlConditions,
  splitWhereClause,
} from './wiqlConditions';

const WIQL = [
  "SELECT [System.Id], [System.Title]",
  "FROM WorkItems",
  "WHERE [System.TeamProject] = @project",
  "  AND [System.State] <> 'Closed'",
  "  OR [System.Tags] CONTAINS 'ui order by'",
  "ORDER BY [System.ChangedDate] DESC",
].join("\n");

describe('splitWhereClause', () => {
  it('ignores keywords inside quoted values', () => {
    const { head, where, tail } = splitWhereClause(WIQL);
    expect(head).toBe("SELECT [System.Id], [System.Title]\nFROM WorkItems\n");
    expect(where).toContain("'ui order by'");
    expect(tail).toBe("ORDER BY [System.ChangedDate] DESC");
  });

  it('finds the tail when there is no WHERE', () => {
    const { where, tail } = splitWhereClause("SELECT [System.Id] FROM WorkItems ORDER BY [System.Id]");
    expect(where).toBe("");
    expect(tail).toBe("ORDER BY [System.Id]");
  });
});

describe('parseWiqlConditions', () => {
  it('reads flat AND/OR conditions', () => {
    expect(parseWiqlConditions(WIQL)).toEqual({
      ok: true,
      conditions: [
        { conjunction: "AND", field: "System.TeamProject", operator: "=", value: "@project" },
        { conjunction: "AND", field: "System.State", operator: "<>", value: "Closed" },
        { conjunction: "OR", field: "System.Tags", operator: "CONTAINS", value: "ui order by" },
      ],
    });
  });

  it('reads lists, macro offsets, numbers, and escaped quotes', () => {
    const result = parseWiqlConditions(
      "SELECT [System.Id] FROM WorkItems WHERE [System.WorkItemType] NOT IN ('Bug', 'Task') " +
        "and [System.ChangedDate] >= @Today - 7 AND [Microsoft.VSTS.Common.Priority] <= 2 " +
        "AND [System.Title] CONTAINS WORDS 'it''s'",
    );
    expect(result.ok && result.conditions.map((c) => [c.operator, c.value])).toEqual([
      ["NOT IN", "Bug, Task"],
      [">=", "@Today - 7"],
      ["<=", "2"],
      ["CONTAINS WORDS", "it's"],
    ]);
  });

  it('returns no conditions when there is no WHERE', () => {
    expect(parseWiqlConditions("SELECT [System.Id] FROM WorkItems")).toEqual({ ok: true, conditions: [] });
  });

  it.each([
    ["WHERE ([System.State] = 'A' OR [System.State] = 'B')", /parentheses/],
    ["WHERE [Source].[System.State] = 'A'", /Link queries/],
    ["WHERE [System.ChangedDate] > [System.CreatedDate]", /two fields/],
    ["WHERE NOT [System.State] = 'A'", /\[Field\]/],
    ["WHERE [System.State] EVER 'A'", /operator/],
  ])('explains why %s cannot be shown', (where, reason) => {
    const result = parseWiqlConditions(`SELECT [System.Id] FROM WorkItems ${where}`);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(reason);
  });
});

describe('replaceWiqlConditions', () => {
  it('rewrites only WHERE and round-trips through the parser', () => {
    const parsed = parseWiqlConditions(WIQL);
    if (!parsed.ok) throw new Error(parsed.reason);
    const next = replaceWiqlConditions(
      WIQL,
      [...parsed.conditions, { conjunction: "AND", field: "Microsoft.VSTS.Common.Priority", operator: "IN", value: "1, 2," }],
      { "Microsoft.VSTS.Common.Priority": "integer", "System.State": "string" },
    );
    expect(next).toBe(
      [
        "SELECT [System.Id], [System.Title]",
        "FROM WorkItems",
        "WHERE [System.TeamProject] = @project",
        "  AND [System.State] <> 'Closed'",
        "  OR [System.Tags] CONTAINS 'ui order by'",
        "  AND [Microsoft.VSTS.Common.Priority] IN (1, 2)",
        "ORDER BY [System.ChangedDate] DESC",
      ].join("\n"),
    );
    const reparsed = parseWiqlConditions(next);
    expect(reparsed.ok && reparsed.conditions).toHaveLength(4);
  });

  it('quotes numbers for text fields and escapes quotes', () => {
    const next = replaceWiqlConditions(
      "SELECT [System.Id] FROM WorkItems",
      [{ conjunction: "AND", field: "System.Title", operator: "=", value: "it's 5" }],
      { "System.Title": "string" },
    );
    expect(next).toBe("SELECT [System.Id] FROM WorkItems\nWHERE [System.Title] = 'it''s 5'");
    expect(
      replaceWiqlConditions(
        "SELECT [System.Id] FROM WorkItems",
        [{ conjunction: "AND", field: "Custom.Code", operator: "=", value: "5" }],
        { "Custom.Code": "string" },
      ),
    ).toContain("= '5'");
  });

  it('drops the WHERE clause when the last condition is removed', () => {
    expect(replaceWiqlConditions(WIQL, [], {})).toBe(
      "SELECT [System.Id], [System.Title]\nFROM WorkItems\nORDER BY [System.ChangedDate] DESC",
    );
  });
});

describe('operatorsForFieldType', () => {
  it('limits operators by type and keeps the current one', () => {
    expect(operatorsForFieldType("boolean")).toEqual(["=", "<>"]);
    expect(operatorsForFieldType("boolean", "IN")).toEqual(["=", "<>", "IN"]);
    expect(operatorsForFieldType(undefined)).toContain("UNDER");
  });
});
