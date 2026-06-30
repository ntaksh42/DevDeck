// Subsequence fuzzy matching for the file finder (VS Code Ctrl+P / GitHub `t`
// style): every character of the query must appear in the target, in order,
// but not necessarily contiguous. Matches score higher when characters are
// consecutive or fall right after a path/word boundary, and a match against
// the file's basename outranks an equal match that only hits the directory
// portion of the path.

function scoreSubsequence(query: string, target: string): number | null {
  if (!query) return 0;
  let queryIndex = 0;
  let score = 0;
  let lastMatchIndex = -1;
  for (let i = 0; i < target.length && queryIndex < query.length; i++) {
    if (target[i] !== query[queryIndex]) continue;
    let charScore = 1;
    if (lastMatchIndex === i - 1) charScore += 3;
    const previous = target[i - 1];
    if (i === 0 || previous === "/" || previous === "-" || previous === "_" || previous === ".") {
      charScore += 2;
    }
    score += charScore;
    lastMatchIndex = i;
    queryIndex++;
  }
  if (queryIndex < query.length) return null;
  // Prefer tighter matches over longer targets with the same hits.
  return score - target.length * 0.01;
}

export type FuzzyFileMatch = {
  path: string;
  score: number;
};

const BASENAME_BONUS = 10;

// Ranks `paths` by how well they match `query`, highest score first. An empty
// query returns the first `limit` paths unscored (lets the picker show
// something before the user types). Ties break alphabetically.
export function fuzzyFindFiles(query: string, paths: string[], limit = 50): FuzzyFileMatch[] {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) {
    return paths.slice(0, limit).map((path) => ({ path, score: 0 }));
  }

  const matches: FuzzyFileMatch[] = [];
  for (const path of paths) {
    const lower = path.toLowerCase();
    const basename = lower.slice(lower.lastIndexOf("/") + 1);
    const basenameScore = scoreSubsequence(trimmed, basename);
    const fullPathScore = scoreSubsequence(trimmed, lower);
    if (basenameScore === null && fullPathScore === null) continue;
    const best = Math.max(
      basenameScore === null ? -Infinity : basenameScore + BASENAME_BONUS,
      fullPathScore === null ? -Infinity : fullPathScore,
    );
    matches.push({ path, score: best });
  }

  matches.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  return matches.slice(0, limit);
}
