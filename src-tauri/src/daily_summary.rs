use std::time::Duration;

use chrono::{Datelike, Local, NaiveDate, NaiveDateTime, Timelike, Weekday};
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::time::{interval, MissedTickBehavior};

use crate::db::{AppDatabase, AppSettings};

/// Payload emitted to the frontend so it can raise the OS notification. The
/// frontend owns notification delivery (see desktopNotifications.ts), matching
/// how PR / work-item notifications already flow.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DailySummaryEvent {
    pub required_pr_count: i64,
    pub active_work_item_count: i64,
}

pub struct DailySummaryScheduler {
    db: AppDatabase,
}

impl DailySummaryScheduler {
    pub fn new(db: AppDatabase) -> Self {
        Self { db }
    }

    /// Ticks on a coarse interval and fires once when the local wall-clock
    /// reaches the configured time. Re-reads settings every tick so enabling,
    /// disabling, or rescheduling takes effect without a restart. Only delivers
    /// while the app process is alive (the issue's stated constraint).
    pub async fn run(self, handle: AppHandle) {
        // 30s keeps a tick inside every target minute even if a tick is briefly
        // delayed, while the `last_fired` guard prevents a double fire.
        let mut ticker = interval(Duration::from_secs(30));
        ticker.set_missed_tick_behavior(MissedTickBehavior::Skip);
        let mut last_fired: Option<NaiveDate> = None;
        loop {
            ticker.tick().await;
            let settings = match self.db.get_app_settings() {
                Ok(settings) => settings,
                Err(e) => {
                    tracing::warn!(error = ?e, "daily summary: failed to load settings");
                    continue;
                }
            };
            let now = Local::now().naive_local();
            if !should_fire_daily_summary(now, &settings, last_fired) {
                continue;
            }
            last_fired = Some(now.date());
            let event = daily_summary_counts(&self.db);
            if let Err(e) = handle.emit("notifications:daily-summary", event) {
                tracing::warn!(error = ?e, "daily summary: failed to emit event");
            }
        }
    }
}

fn daily_summary_counts(db: &AppDatabase) -> DailySummaryEvent {
    let orgs = db.list_organizations().unwrap_or_default();
    let mut required_pr_count = 0i64;
    let mut active_work_item_count = 0i64;
    for org in &orgs {
        if let Ok(prs) = db.list_review_pull_requests(&org.id) {
            required_pr_count += prs
                .iter()
                .filter(|pr| pr.my_is_required && pr.my_vote == 0)
                .count() as i64;
        }
        if let Ok(items) = db.list_my_work_items(&org.id) {
            active_work_item_count += items.len() as i64;
        }
    }
    DailySummaryEvent {
        required_pr_count,
        active_work_item_count,
    }
}

/// Pure scheduling decision: fire when enabled, the configured time matches the
/// current minute, it has not already fired today, and the weekday filter (if
/// on) allows it.
pub fn should_fire_daily_summary(
    now: NaiveDateTime,
    settings: &AppSettings,
    last_fired: Option<NaiveDate>,
) -> bool {
    if !settings.daily_summary_enabled {
        return false;
    }
    let Some((hour, minute)) = parse_hhmm(&settings.daily_summary_time) else {
        return false;
    };
    if now.hour() != hour || now.minute() != minute {
        return false;
    }
    if last_fired == Some(now.date()) {
        return false;
    }
    if settings.daily_summary_weekdays_only && matches!(now.weekday(), Weekday::Sat | Weekday::Sun)
    {
        return false;
    }
    true
}

fn parse_hhmm(value: &str) -> Option<(u32, u32)> {
    let parts: Vec<&str> = value.trim().split(':').collect();
    if parts.len() != 2 {
        return None;
    }
    let hour = parts[0].parse::<u32>().ok()?;
    let minute = parts[1].parse::<u32>().ok()?;
    (hour < 24 && minute < 60).then_some((hour, minute))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(text: &str) -> NaiveDateTime {
        NaiveDateTime::parse_from_str(text, "%Y-%m-%d %H:%M:%S").unwrap()
    }

    fn settings(enabled: bool, time: &str, weekdays_only: bool) -> AppSettings {
        AppSettings {
            daily_summary_enabled: enabled,
            daily_summary_time: time.to_string(),
            daily_summary_weekdays_only: weekdays_only,
            ..AppSettings::default()
        }
    }

    #[test]
    fn parse_hhmm_accepts_valid_and_rejects_invalid() {
        assert_eq!(parse_hhmm("09:00"), Some((9, 0)));
        assert_eq!(parse_hhmm("23:59"), Some((23, 59)));
        assert_eq!(parse_hhmm(" 7:5 "), Some((7, 5)));
        assert_eq!(parse_hhmm("24:00"), None);
        assert_eq!(parse_hhmm("09:60"), None);
        assert_eq!(parse_hhmm("noon"), None);
        assert_eq!(parse_hhmm("09:00:00"), None);
    }

    #[test]
    fn does_not_fire_when_disabled() {
        let s = settings(false, "09:00", false);
        // 2026-06-22 is a Monday.
        assert!(!should_fire_daily_summary(
            at("2026-06-22 09:00:10"),
            &s,
            None
        ));
    }

    #[test]
    fn fires_at_the_configured_minute_once_per_day() {
        let s = settings(true, "09:00", false);
        let now = at("2026-06-22 09:00:10");
        assert!(should_fire_daily_summary(now, &s, None));
        // Already fired today -> suppressed.
        assert!(!should_fire_daily_summary(now, &s, Some(now.date())));
    }

    #[test]
    fn does_not_fire_outside_the_configured_minute() {
        let s = settings(true, "09:00", false);
        assert!(!should_fire_daily_summary(
            at("2026-06-22 09:01:00"),
            &s,
            None
        ));
        assert!(!should_fire_daily_summary(
            at("2026-06-22 08:59:00"),
            &s,
            None
        ));
    }

    #[test]
    fn weekdays_only_skips_the_weekend() {
        let s = settings(true, "09:00", true);
        // 2026-06-20 Sat, 2026-06-21 Sun, 2026-06-22 Mon.
        assert!(!should_fire_daily_summary(
            at("2026-06-20 09:00:00"),
            &s,
            None
        ));
        assert!(!should_fire_daily_summary(
            at("2026-06-21 09:00:00"),
            &s,
            None
        ));
        assert!(should_fire_daily_summary(
            at("2026-06-22 09:00:00"),
            &s,
            None
        ));
    }
}
