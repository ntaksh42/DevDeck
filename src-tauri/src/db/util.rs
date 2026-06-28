/// Appends ` AND {column} IN (?, ?, ...)` for a non-empty value list, binding
/// each value. A `None`/empty list is a no-op so callers can pass an absent
/// filter unconditionally.
pub(crate) fn push_in_clause(
    sql: &mut String,
    bind: &mut Vec<Box<dyn rusqlite::ToSql>>,
    column: &str,
    values: Option<&[String]>,
) {
    let Some(values) = values.filter(|values| !values.is_empty()) else {
        return;
    };
    let start = bind.len() + 1;
    let placeholders: Vec<String> = (0..values.len())
        .map(|offset| format!("?{}", start + offset))
        .collect();
    sql.push_str(&format!(" AND {column} IN ({})", placeholders.join(", ")));
    for value in values {
        bind.push(Box::new(value.clone()));
    }
}

pub(crate) fn escape_like_pattern(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}

pub(crate) fn fts5_query(input: &str) -> String {
    let words: Vec<String> = input
        .split_whitespace()
        .map(|w| format!("\"{}\"*", w.replace('"', "")))
        .collect();
    words.join(" OR ")
}
