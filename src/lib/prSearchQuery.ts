import type { PullRequestSummary } from "./commands/prs";

export type PrSearchTerm = {
  text: string;
  exclude: boolean;
  exactId?: string;
  numericPrefix?: boolean;
};

// Kept in step with prs/query.rs. Parsing also runs before IPC so malformed
// searches do not start a potentially expensive live scan.
export function parsePrSearchQuery(raw: string, excludeWords = ""): PrSearchTerm[] {
  const tokenize = (input: string, forceExclude: boolean): PrSearchTerm[] => {
    if ([...input].length > 200) throw new Error("Search text must be at most 200 characters.");
    const terms: PrSearchTerm[] = [];
    let i = 0;
    while (i < input.length) {
      if (/\s/u.test(input[i])) { i++; continue; }
      const exclude = input[i] === "-";
      if (exclude) i++;
      const quoted = input[i] === '"';
      let text = "";
      if (quoted) {
        i++;
        let closed = false;
        while (i < input.length) {
          const char = input[i++];
          if (char === '"') { closed = true; break; }
          if (char === "\\") {
            const escaped = input[i++];
            if (escaped !== '"' && escaped !== "\\") {
              throw new Error("Use \\\" or \\\\ to escape characters inside a phrase.");
            }
            text += escaped;
          } else text += char;
        }
        if (!closed) throw new Error("Close the quotation mark before searching.");
        if (i < input.length && !/\s/u.test(input[i])) {
          throw new Error("Separate search phrases with spaces.");
        }
      } else {
        while (i < input.length && !/\s/u.test(input[i])) {
          if (input[i] === '"') throw new Error("Put quotation marks around the whole phrase.");
          text += input[i++];
        }
      }
      if (!text.trim()) throw new Error("Enter a word or phrase after the search operator.");
      const term: PrSearchTerm = { text: text.toLowerCase(), exclude: forceExclude || exclude };
      if (!quoted && text.startsWith("#")) {
        const number = text.slice(1);
        if (!/^[1-9]\d*$/.test(number) || Number(number) > 2_147_483_647) {
          throw new Error("Use # followed by a positive PR number.");
        }
        term.exactId = number;
      } else if (!quoted && /^\d+$/.test(text)) term.numericPrefix = true;
      terms.push(term);
    }
    return terms;
  };
  const terms = [...tokenize(raw, false), ...tokenize(excludeWords, true)];
  if (terms.length > 20) throw new Error("Use at most 20 search terms.");
  return terms;
}

export function matchesPrSearchQuery(
  terms: PrSearchTerm[],
  pr: PullRequestSummary,
): boolean {
  const fields = [pr.title, pr.projectName, pr.repositoryName, pr.createdBy ?? "",
    pr.sourceRefName, pr.targetRefName].map((field) => field.toLowerCase());
  return terms.every((term) => {
    const matched = term.exactId !== undefined
      ? String(pr.pullRequestId) === term.exactId
      : (term.numericPrefix && String(pr.pullRequestId).startsWith(term.text)) ||
        fields.some((field) => field.includes(term.text));
    return term.exclude ? !matched : matched;
  });
}
