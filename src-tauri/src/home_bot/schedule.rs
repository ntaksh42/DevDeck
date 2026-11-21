//! When Look around runs: fixed local hours per preset, never at night, a
//! slot missed while asleep caught up once the same day.

use chrono::{DateTime, Datelike, Duration, Local, NaiveTime, TimeZone, Weekday};

use super::store::RunRow;
use super::types::HomeBotSettings;

/// A look started this soon before a slot (e.g. Look now) stands in for it.
pub(crate) const LOOK_RECENT_MS: i64 = 60 * 60 * 1000;
/// A usage limit holds scheduled looks this long.
pub(crate) const USAGE_LIMIT_HOLD_MS: i64 = 60 * 60 * 1000;
/// Failed looks in a row that turn Look around off.
pub(crate) const FAILURES_TO_TURN_OFF: i64 = 10;

pub(crate) fn hours(every: &str) -> &'static [u32] {
    match every {
        "every-4h" => &[8, 12, 16, 20],
        "every-2h" => &[8, 10, 12, 14, 16, 18, 20],
        "mornings" => &[8],
        _ => &[8, 13],
    }
}

fn is_weekend(day: Weekday) -> bool {
    matches!(day, Weekday::Sat | Weekday::Sun)
}

fn slot_on(date: chrono::NaiveDate, hour: u32) -> Option<DateTime<Local>> {
    let time = NaiveTime::from_hms_opt(hour, 0, 0)?;
    Local.from_local_datetime(&date.and_time(time)).earliest()
}

/// Today's latest slot at or before `now`, as Unix milliseconds.
fn latest_slot_today(settings: &HomeBotSettings, now: DateTime<Local>) -> Option<i64> {
    if settings.weekdays_only && is_weekend(now.weekday()) {
        return None;
    }
    hours(&settings.every)
        .iter()
        .filter_map(|hour| slot_on(now.date_naive(), *hour))
        .filter(|slot| *slot <= now)
        .map(|slot| slot.timestamp_millis())
        .max()
}

/// The slot due now, or None: off, not armed yet (the Home view was never
/// opened), already looked for, held by a usage limit, or before it was turned on.
pub(crate) fn due_slot(
    settings: &HomeBotSettings,
    armed_at: Option<i64>,
    enabled_since: Option<i64>,
    runs: &[RunRow],
    now: DateTime<Local>,
) -> Option<i64> {
    if !settings.enabled {
        return None;
    }
    let armed_at = armed_at?;
    let slot = latest_slot_today(settings, now)?;
    if slot < armed_at || slot < enabled_since.unwrap_or(0) {
        return None;
    }
    if runs.iter().any(|run| run.ended_at.is_none()) {
        return None;
    }
    if let Some(last) = runs.iter().find(|run| run.ended_at.is_some()) {
        if last.outcome.as_deref() == Some("usage_limited")
            && now.timestamp_millis() < last.ended_at.unwrap_or(0) + USAGE_LIMIT_HOLD_MS
        {
            return None;
        }
    }
    let taken = runs
        .iter()
        .any(|run| run.slot_at == Some(slot) || run.started_at > slot - LOOK_RECENT_MS);
    (!taken).then_some(slot)
}

/// When the next scheduled look starts, for "Next look 8:00 (Mon)".
pub(crate) fn next_slot(
    settings: &HomeBotSettings,
    now: DateTime<Local>,
) -> Option<DateTime<Local>> {
    if !settings.enabled {
        return None;
    }
    (0..8).find_map(|offset| {
        let date = now.date_naive() + Duration::days(offset);
        if settings.weekdays_only && is_weekend(date.weekday()) {
            return None;
        }
        hours(&settings.every)
            .iter()
            .filter_map(|hour| slot_on(date, *hour))
            .find(|slot| *slot > now)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(day: u32, hour: u32, minute: u32) -> DateTime<Local> {
        // 2026-11-16 is a Monday.
        Local
            .with_ymd_and_hms(2026, 11, day, hour, minute, 0)
            .unwrap()
    }

    fn settings() -> HomeBotSettings {
        HomeBotSettings::default()
    }

    fn run(slot: Option<i64>, started: i64, outcome: &str) -> RunRow {
        RunRow {
            id: 1,
            slot_at: slot,
            started_at: started,
            ended_at: Some(started + 1000),
            outcome: Some(outcome.into()),
            error: None,
            brief: vec![],
        }
    }

    #[test]
    fn the_morning_slot_is_due_once() {
        let armed = Some(at(16, 7, 0).timestamp_millis());
        let now = at(16, 9, 30);
        let slot = due_slot(&settings(), armed, None, &[], now).unwrap();
        assert_eq!(slot, at(16, 8, 0).timestamp_millis());
        let done = run(Some(slot), now.timestamp_millis(), "ok");
        assert_eq!(due_slot(&settings(), armed, None, &[done], now), None);
    }

    #[test]
    fn needs_arming_and_skips_weekends_and_night() {
        assert_eq!(due_slot(&settings(), None, None, &[], at(16, 9, 0)), None);
        let armed = Some(at(1, 0, 0).timestamp_millis());
        assert_eq!(due_slot(&settings(), armed, None, &[], at(21, 9, 0)), None);
        assert_eq!(due_slot(&settings(), armed, None, &[], at(16, 7, 0)), None);
    }

    #[test]
    fn a_recent_look_now_stands_in_for_the_slot() {
        let armed = Some(at(1, 0, 0).timestamp_millis());
        let manual = run(None, at(16, 12, 30).timestamp_millis(), "ok");
        assert_eq!(
            due_slot(&settings(), armed, None, &[manual], at(16, 13, 5)),
            None
        );
    }

    #[test]
    fn a_usage_limit_holds_the_next_slot() {
        let armed = Some(at(1, 0, 0).timestamp_millis());
        let limited = run(
            Some(at(16, 8, 0).timestamp_millis()),
            at(16, 12, 50).timestamp_millis(),
            "usage_limited",
        );
        assert_eq!(
            due_slot(&settings(), armed, None, &[limited], at(16, 13, 10)),
            None
        );
    }

    #[test]
    fn next_slot_skips_to_monday() {
        let next = next_slot(&settings(), at(20, 14, 0)).unwrap();
        assert_eq!(next, at(23, 8, 0));
        let off = HomeBotSettings {
            enabled: false,
            ..settings()
        };
        assert_eq!(next_slot(&off, at(20, 14, 0)), None);
    }
}
