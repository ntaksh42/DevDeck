// Parsing for the commit search box's `path:` filter syntax (issue #302).
//
// A `path:` token restricts results to commits that changed files under that
// path. Because the SQLite commit cache does not record per-commit changed
// paths, this filter is always applied server-side (Azure DevOps
// `searchCriteria.itemPath`), which is why a repository must be selected.

export type ParsedCommitQuery = {
  /** Free-text keyword query with any `path:` tokens removed. */
  keyword: string;
  /** Path from the (last) `path:` token, or null when none was given. */
  itemPath: string | null;
};

// Matches a `path:` token with either a quoted value (path:"src/my dir") or an
// unquoted value that ends at the next whitespace (path:src/auth).
const PATH_TOKEN = /(?:^|\s)path:(?:"([^"]*)"|(\S+))/gi;

/**
 * Splits a raw commit search box value into a keyword query and an optional
 * `path:` filter. When several `path:` tokens are present the last one wins,
 * mirroring how a single server-side criterion can be sent.
 */
export function extractCommitQuery(raw: string): ParsedCommitQuery {
  let itemPath: string | null = null;
  const keyword = raw
    .replace(PATH_TOKEN, (_match, quoted: string | undefined, bare: string | undefined) => {
      const value = (quoted ?? bare ?? "").trim();
      if (value) itemPath = value;
      return " ";
    })
    .replace(/\s+/g, " ")
    .trim();
  return { keyword, itemPath };
}
