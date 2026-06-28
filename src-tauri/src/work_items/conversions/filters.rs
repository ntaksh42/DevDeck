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

/// Membership test for an optional multi-value filter: `None` (no filter)
/// matches everything; otherwise the value must be present in the set.
pub(crate) fn filter_matches(filter: &Option<Vec<String>>, value: Option<&str>) -> bool {
    match filter {
        None => true,
        Some(values) => value.is_some_and(|value| values.iter().any(|f| f == value)),
    }
}
