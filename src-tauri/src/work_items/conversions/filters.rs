/// Trims and drops blank entries from a multi-value filter, returning `None`
/// when nothing is left so callers can treat "no values" as "no filter".
pub(crate) fn normalize_filter_set(values: Option<Vec<String>>) -> Option<Vec<String>> {
    let cleaned: Vec<String> = values
        .unwrap_or_default()
        .into_iter()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .collect();
    (!cleaned.is_empty()).then_some(cleaned)
}
