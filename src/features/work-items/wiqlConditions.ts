/**
 * Two-way bridge between a WIQL WHERE clause and the "Build conditions" grid.
 * The grid is always derived from the WIQL text, and every grid edit rewrites
 * only the WHERE clause, so SELECT / ORDER BY / ASOF stay exactly as written.
 */

export type WiqlConjunction = "AND" | "OR";

export type WiqlCondition = {
  conjunction: WiqlConjunction;
  field: string;
  operator: string;
  value: string;
};

export type ParsedConditions =
  | { ok: true; conditions: WiqlCondition[] }
  | { ok: false; reason: string };

const WORD_OPERATORS = [
  "NOT CONTAINS WORDS",
  "CONTAINS WORDS",
  "NOT CONTAINS",
  "CONTAINS",
  "NOT IN GROUP",
  "IN GROUP",
  "NOT IN",
  "IN",
  "NOT UNDER",
  "UNDER",
];
const COMPARISON = ["=", "<>", ">", "<", ">=", "<="];
const LIST_OPERATORS = new Set(["IN", "NOT IN"]);

const OPERATORS_BY_TYPE: Record<string, string[]> = {
  string: [...COMPARISON, "CONTAINS", "NOT CONTAINS", "IN", "NOT IN", "IN GROUP", "NOT IN GROUP"],
  plainText: ["CONTAINS WORDS", "NOT CONTAINS WORDS", "CONTAINS", "NOT CONTAINS"],
  html: ["CONTAINS WORDS", "NOT CONTAINS WORDS"],
  integer: [...COMPARISON, "IN", "NOT IN"],
  double: [...COMPARISON, "IN", "NOT IN"],
  dateTime: [...COMPARISON, "IN", "NOT IN"],
  treePath: ["=", "<>", "UNDER", "NOT UNDER", "IN", "NOT IN"],
  identity: ["=", "<>", "CONTAINS", "NOT CONTAINS", "IN", "NOT IN", "IN GROUP", "NOT IN GROUP"],
  boolean: ["=", "<>"],
};
const ALL_OPERATORS = [...COMPARISON, ...WORD_OPERATORS.slice().reverse()];

/** Types of common system fields, used until (or unless) the field list loads. */
export const KNOWN_FIELD_TYPES: Record<string, string> = {
  "System.Id": "integer",
  "System.Title": "string",
  "System.State": "string",
  "System.WorkItemType": "string",
  "System.AssignedTo": "identity",
  "System.CreatedBy": "identity",
  "System.ChangedDate": "dateTime",
  "System.CreatedDate": "dateTime",
  "System.TeamProject": "string",
  "System.Tags": "plainText",
  "System.AreaPath": "treePath",
  "System.IterationPath": "treePath",
  "Microsoft.VSTS.Common.Priority": "integer",
  "Microsoft.VSTS.Common.Severity": "string",
};

/** Operators that make sense for a field type; unknown types get every operator. */
export function operatorsForFieldType(fieldType: string | undefined, current?: string): string[] {
  const base = (fieldType && OPERATORS_BY_TYPE[fieldType]) || ALL_OPERATORS;
  return current && !base.includes(current) ? [...base, current] : base;
}

// Replace the inside of quoted strings and [field] references with "_" so
// keyword searches cannot match inside them, while keeping every offset intact.
function maskLiterals(wiql: string): string {
  return wiql.replace(/'(?:[^']|'')*'|"(?:[^"]|"")*"|\[[^\]]*\]/g, (literal) =>
    literal[0] + "_".repeat(literal.length - 2) + literal[literal.length - 1],
  );
}

/** Splits WIQL around its WHERE clause body. `where` is "" when there is none. */
export function splitWhereClause(wiql: string): { head: string; where: string; tail: string } {
  const masked = maskLiterals(wiql);
  const whereMatch = /\bWHERE\b/i.exec(masked);
  const searchFrom = whereMatch ? whereMatch.index + whereMatch[0].length : 0;
  const tailPattern = /\b(?:ORDER\s+BY|GROUP\s+BY|ASOF|MODE)\b/gi;
  tailPattern.lastIndex = searchFrom;
  const tailMatch = tailPattern.exec(masked);
  const tailStart = tailMatch ? tailMatch.index : wiql.length;
  if (!whereMatch) {
    return { head: wiql.slice(0, tailStart), where: "", tail: wiql.slice(tailStart) };
  }
  return {
    head: wiql.slice(0, whereMatch.index),
    where: wiql.slice(searchFrom, tailStart),
    tail: wiql.slice(tailStart),
  };
}

type Token = { kind: "field" | "string" | "macro" | "number" | "symbol" | "word"; text: string };

const TOKEN_PATTERN =
  /\s+|(\[[^\]]*\])|('(?:[^']|'')*'|"(?:[^"]|"")*")|(@[A-Za-z][\w.]*)|(-?\d+(?:\.\d+)?)|(<>|>=|<=|=|>|<|\(|\)|,|\+|-|\.)|([A-Za-z_]\w*)|(.)/gy;

function tokenize(text: string): Token[] | string {
  const tokens: Token[] = [];
  TOKEN_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TOKEN_PATTERN.exec(text))) {
    if (match[1]) tokens.push({ kind: "field", text: match[1].slice(1, -1) });
    else if (match[2]) tokens.push({ kind: "string", text: match[2] });
    else if (match[3]) tokens.push({ kind: "macro", text: match[3] });
    else if (match[4]) tokens.push({ kind: "number", text: match[4] });
    else if (match[5]) tokens.push({ kind: "symbol", text: match[5] });
    else if (match[6]) tokens.push({ kind: "word", text: match[6] });
    else if (match[7]) return `Unexpected character "${match[7]}".`;
  }
  return tokens;
}

function unquote(literal: string): string {
  const quote = literal[0];
  return literal.slice(1, -1).split(quote + quote).join(quote);
}

/** Parses a WHERE clause body into flat AND/OR conditions, or explains why it cannot. */
export function parseWhereConditions(where: string): ParsedConditions {
  const tokenized = tokenize(where);
  if (typeof tokenized === "string") return { ok: false, reason: tokenized };
  const tokens = tokenized;
  const conditions: WiqlCondition[] = [];
  let index = 0;
  const peek = () => tokens[index];
  const upper = (offset = 0) => tokens[index + offset]?.text.toUpperCase();

  function readValue(): string | null {
    const token = peek();
    if (!token) return null;
    if (token.kind === "string") {
      index += 1;
      return unquote(token.text);
    }
    if (token.kind === "number" || (token.kind === "word" && /^(true|false)$/i.test(token.text))) {
      index += 1;
      return token.text;
    }
    if (token.kind === "macro") {
      index += 1;
      let value = token.text;
      const sign = peek();
      const amount = tokens[index + 1];
      if (sign?.kind === "symbol" && (sign.text === "+" || sign.text === "-") && amount?.kind === "number") {
        value += ` ${sign.text} ${amount.text}`;
        index += 2;
      } else if (sign?.kind === "number" && /^-\d/.test(sign.text)) {
        // "@Today -7" tokenizes the sign into the number.
        value += ` - ${sign.text.slice(1)}`;
        index += 1;
      }
      return value;
    }
    return null;
  }

  while (index < tokens.length) {
    let conjunction: WiqlConjunction = "AND";
    if (conditions.length > 0) {
      const word = upper();
      if (word !== "AND" && word !== "OR") {
        return { ok: false, reason: `Expected AND or OR before "${peek()?.text}".` };
      }
      conjunction = word;
      index += 1;
    }
    const fieldToken = peek();
    if (fieldToken?.kind === "symbol" && fieldToken.text === "(") {
      return { ok: false, reason: "Grouped conditions (parentheses) are not supported." };
    }
    if (fieldToken?.kind !== "field") {
      return { ok: false, reason: `Expected a [Field] reference, found "${fieldToken?.text ?? "end of query"}".` };
    }
    if (upper(1) === ".") {
      return { ok: false, reason: "Link queries ([Source].[Field]) are not supported." };
    }
    index += 1;

    let operator: string | undefined;
    const symbol = peek();
    if (symbol?.kind === "symbol" && COMPARISON.includes(symbol.text)) {
      operator = symbol.text;
      index += 1;
    } else {
      operator = WORD_OPERATORS.find((candidate) =>
        candidate.split(" ").every((word, offset) => upper(offset) === word),
      );
      if (operator) index += operator.split(" ").length;
    }
    if (!operator) {
      return { ok: false, reason: `Unsupported operator "${peek()?.text ?? "end of query"}".` };
    }

    let value: string | null;
    if (LIST_OPERATORS.has(operator)) {
      if (upper() !== "(") return { ok: false, reason: `${operator} needs a (list) of values.` };
      index += 1;
      const items: string[] = [];
      while (upper() !== ")") {
        const item = readValue();
        if (item === null) return { ok: false, reason: `Unsupported value in ${operator} list.` };
        items.push(item);
        if (upper() === ",") index += 1;
        else if (upper() !== ")") return { ok: false, reason: `Expected "," or ")" in ${operator} list.` };
      }
      index += 1;
      value = items.join(", ");
    } else {
      value = readValue();
      if (value === null) {
        const found = peek();
        return {
          ok: false,
          reason: found?.kind === "field"
            ? "Comparing two fields is not supported."
            : `Unsupported value "${found?.text ?? "end of query"}".`,
        };
      }
    }
    conditions.push({ conjunction, field: fieldToken.text, operator, value });
  }
  return { ok: true, conditions };
}

export function parseWiqlConditions(wiql: string): ParsedConditions {
  return parseWhereConditions(splitWhereClause(wiql).where);
}

const NUMERIC_TYPES = new Set(["integer", "double", "picklistInteger", "picklistDouble"]);

function serializeAtom(raw: string, fieldType: string | undefined): string {
  const value = raw.trim();
  if (/^@[A-Za-z][\w.]*(\s*[+-]\s*\d+)?$/.test(value)) return value.replace(/\s*([+-])\s*/, " $1 ");
  if (/^-?\d+(\.\d+)?$/.test(value) && (!fieldType || NUMERIC_TYPES.has(fieldType))) return value;
  if (fieldType === "boolean" && /^(true|false)$/i.test(value)) return value;
  return `'${raw.split("'").join("''")}'`;
}

function serializeCondition(condition: WiqlCondition, fieldType: string | undefined): string {
  const value = LIST_OPERATORS.has(condition.operator)
    ? `(${condition.value
        .split(",")
        .filter((item) => item.trim())
        .map((item) => serializeAtom(item.trim(), fieldType))
        .join(", ")})`
    : serializeAtom(condition.value, fieldType);
  return `[${condition.field}] ${condition.operator} ${value}`;
}

/** Rewrites only the WHERE clause of `wiql`; an empty list removes the clause. */
export function replaceWiqlConditions(
  wiql: string,
  conditions: WiqlCondition[],
  fieldTypes: Record<string, string | undefined>,
): string {
  const { head, tail } = splitWhereClause(wiql);
  const parts = [head.trimEnd()];
  if (conditions.length > 0) {
    const body = conditions
      .map((condition, index) => {
        const text = serializeCondition(condition, fieldTypes[condition.field]);
        return index === 0 ? text : `${condition.conjunction} ${text}`;
      })
      .join("\n  ");
    parts.push(`WHERE ${body}`);
  }
  if (tail.trim()) parts.push(tail.trim());
  return parts.join("\n");
}
