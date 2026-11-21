use super::parse_date_bound;

#[test]
fn date_bounds_follow_the_users_calendar_day() {
    // 2026-05-01 in Japan (UTC+9) starts at 2026-04-30 15:00 UTC.
    let from = parse_date_bound(Some("2026-05-01"), false, Some(540))
        .unwrap()
        .unwrap();
    let to = parse_date_bound(Some("2026-05-31"), true, Some(540))
        .unwrap()
        .unwrap();
    assert!(from.starts_with("2026-04-30T15:00:00"), "{from}");
    assert!(to.starts_with("2026-05-31T14:59:59"), "{to}");
    assert!(parse_date_bound(Some("2026-05-01"), false, Some(24 * 60)).is_err());
}
