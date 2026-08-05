//! Rewrites a caller-supplied WIQL query so it reports the state of the work
//! items at a past point in time.
//!
//! WIQL puts `ASOF` between the `WHERE` clause and `ORDER BY`, so the clause
//! cannot simply be appended to every query. These helpers find the insertion
//! point without disturbing the rest of the query text.

use crate::error::{AdoError, Result};

/// Splits `wiql` into the part that precedes `ORDER BY` and the `ORDER BY`
/// clause itself. Returns `None` when the query has no top-level `ORDER BY`.
///
/// Only occurrences outside single-quoted string literals count, so a query
/// filtering on a value like `'ORDER BY'` is not mistaken for a clause.
fn split_order_by(wiql: &str) -> Option<usize> {
    let bytes = wiql.as_bytes();
    let mut in_string = false;
    let mut index = 0;

    while index < bytes.len() {
        let byte = bytes[index];
        if in_string {
            // WIQL escapes a quote inside a literal by doubling it.
            if byte == b'\'' {
                if bytes.get(index + 1) == Some(&b'\'') {
                    index += 2;
                    continue;
                }
                in_string = false;
            }
            index += 1;
            continue;
        }
        if byte == b'\'' {
            in_string = true;
            index += 1;
            continue;
        }
        if (byte == b'o' || byte == b'O') && starts_keyword(wiql, index, "order") {
            if let Some(after) = keyword_end(wiql, index + "order".len(), "by") {
                let _ = after;
                return Some(index);
            }
        }
        index += 1;
    }
    None
}

/// True when the keyword starts at `index` and is not part of a longer word.
fn starts_keyword(text: &str, index: usize, keyword: &str) -> bool {
    if !text.is_char_boundary(index) {
        return false;
    }
    let rest = &text[index..];
    if rest.len() < keyword.len() {
        return false;
    }
    if !rest[..keyword.len()].eq_ignore_ascii_case(keyword) {
        return false;
    }
    if index > 0 {
        let prev = text[..index].chars().next_back();
        if prev.is_some_and(|c| c.is_alphanumeric() || c == '_' || c == '[') {
            return false;
        }
    }
    let next = rest[keyword.len()..].chars().next();
    !next.is_some_and(|c| c.is_alphanumeric() || c == '_')
}

/// Returns the offset just past `keyword` when it follows `start` separated
/// only by whitespace. Used to require the `BY` of an `ORDER BY` pair.
fn keyword_end(text: &str, start: usize, keyword: &str) -> Option<usize> {
    let mut index = start;
    let bytes = text.as_bytes();
    let mut saw_space = false;
    while index < bytes.len() && bytes[index].is_ascii_whitespace() {
        saw_space = true;
        index += 1;
    }
    if !saw_space {
        return None;
    }
    if starts_keyword(text, index, keyword) {
        Some(index + keyword.len())
    } else {
        None
    }
}

/// True when the query already carries its own top-level `ASOF` clause.
pub fn has_asof_clause(wiql: &str) -> bool {
    let bytes = wiql.as_bytes();
    let mut in_string = false;
    let mut index = 0;

    while index < bytes.len() {
        let byte = bytes[index];
        if in_string {
            if byte == b'\'' {
                if bytes.get(index + 1) == Some(&b'\'') {
                    index += 2;
                    continue;
                }
                in_string = false;
            }
            index += 1;
            continue;
        }
        if byte == b'\'' {
            in_string = true;
            index += 1;
            continue;
        }
        if (byte == b'a' || byte == b'A') && starts_keyword(wiql, index, "asof") {
            return true;
        }
        index += 1;
    }
    false
}

/// Returns `wiql` with `ASOF '<timestamp>'` inserted ahead of any `ORDER BY`.
///
/// `timestamp` must already be an Azure DevOps-compatible instant such as
/// `2026-08-05T00:00:00Z`; it is embedded in the query, so a value containing a
/// quote is rejected rather than escaped into a different query.
pub fn with_asof(wiql: &str, timestamp: &str) -> Result<String> {
    if has_asof_clause(wiql) {
        return Err(AdoError::WiqlQueryShape(
            "query already contains an ASOF clause".to_string(),
        ));
    }
    if timestamp.contains('\'') {
        return Err(AdoError::WiqlQueryShape(
            "ASOF timestamp must not contain a quote".to_string(),
        ));
    }

    let asof = format!("ASOF '{timestamp}'");
    match split_order_by(wiql) {
        Some(index) => {
            let head = wiql[..index].trim_end();
            let tail = &wiql[index..];
            Ok(format!("{head}\n{asof}\n{tail}"))
        }
        None => Ok(format!("{}\n{asof}", wiql.trim_end())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn appends_asof_when_query_has_no_order_by() {
        let wiql = "SELECT [System.Id] FROM WorkItems WHERE [System.State] = 'Active'";
        let result = with_asof(wiql, "2026-08-05T00:00:00Z").unwrap();
        assert_eq!(
            result,
            "SELECT [System.Id] FROM WorkItems WHERE [System.State] = 'Active'\nASOF '2026-08-05T00:00:00Z'"
        );
    }

    #[test]
    fn inserts_asof_before_order_by() {
        let wiql = "SELECT [System.Id]\nFROM WorkItems\nWHERE [System.State] = 'Active'\nORDER BY [System.ChangedDate] DESC";
        let result = with_asof(wiql, "2026-08-05T00:00:00Z").unwrap();
        assert_eq!(
            result,
            "SELECT [System.Id]\nFROM WorkItems\nWHERE [System.State] = 'Active'\nASOF '2026-08-05T00:00:00Z'\nORDER BY [System.ChangedDate] DESC"
        );
    }

    #[test]
    fn ignores_order_by_inside_a_string_literal() {
        let wiql = "SELECT [System.Id] FROM WorkItems WHERE [System.Title] = 'ORDER BY me'";
        let result = with_asof(wiql, "2026-08-05T00:00:00Z").unwrap();
        assert!(result.ends_with("'ORDER BY me'\nASOF '2026-08-05T00:00:00Z'"));
    }

    #[test]
    fn ignores_a_doubled_quote_inside_a_literal() {
        let wiql = "SELECT [System.Id] FROM WorkItems WHERE [System.Title] = 'it''s ORDER BY'";
        let result = with_asof(wiql, "2026-08-05T00:00:00Z").unwrap();
        assert!(result.ends_with("'it''s ORDER BY'\nASOF '2026-08-05T00:00:00Z'"));
    }

    #[test]
    fn does_not_treat_a_field_named_order_as_a_clause() {
        let wiql = "SELECT [System.Id] FROM WorkItems WHERE [Custom.OrderBy] = 3";
        let result = with_asof(wiql, "2026-08-05T00:00:00Z").unwrap();
        assert!(result.ends_with("= 3\nASOF '2026-08-05T00:00:00Z'"));
    }

    #[test]
    fn requires_by_to_follow_order() {
        // "ORDER" alone is not the clause, so the ASOF still goes at the end.
        let wiql = "SELECT [System.Id] FROM WorkItems WHERE [Custom.Order] = 'ORDER'";
        let result = with_asof(wiql, "2026-08-05T00:00:00Z").unwrap();
        assert!(result.ends_with("'ORDER'\nASOF '2026-08-05T00:00:00Z'"));
    }

    #[test]
    fn rejects_a_query_that_already_has_asof() {
        let wiql = "SELECT [System.Id] FROM WorkItems ASOF '2026-01-01T00:00:00Z'";
        assert!(with_asof(wiql, "2026-08-05T00:00:00Z").is_err());
    }

    #[test]
    fn detects_asof_only_outside_string_literals() {
        assert!(!has_asof_clause(
            "SELECT [System.Id] FROM WorkItems WHERE [System.Title] = 'asof'"
        ));
        assert!(has_asof_clause(
            "SELECT [System.Id] FROM WorkItems ASOF '2026-01-01T00:00:00Z'"
        ));
    }

    #[test]
    fn rejects_a_timestamp_containing_a_quote() {
        let wiql = "SELECT [System.Id] FROM WorkItems";
        assert!(with_asof(wiql, "2026-08-05' OR '1'='1").is_err());
    }

    #[test]
    fn trims_trailing_whitespace_before_appending() {
        let wiql = "SELECT [System.Id] FROM WorkItems   \n\n";
        let result = with_asof(wiql, "2026-08-05T00:00:00Z").unwrap();
        assert_eq!(
            result,
            "SELECT [System.Id] FROM WorkItems\nASOF '2026-08-05T00:00:00Z'"
        );
    }
}
