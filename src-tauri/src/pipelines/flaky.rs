//! Flaky test detection: compares the failed tests of a pipeline's recent
//! completed runs. Only failed results are fetched, so a test "passed" in a
//! run when the run published tests and none of its fully fetched failed lists
//! names it.

use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};

/// Runs looked at when the caller does not say.
pub(super) const DEFAULT_FLAKY_RUNS: u32 = 10;
/// Most runs one request may look at (each costs at least one API call).
pub(super) const MAX_FLAKY_RUNS: u32 = 25;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListFlakyTestsInput {
    pub organization_id: Option<String>,
    pub project_id: String,
    pub definition_id: i64,
    /// Only runs of this branch (`refs/heads/main`, `refs/pull/1/merge`, ...).
    pub branch: Option<String>,
    /// How many recent completed runs to compare (default 10, at most 25).
    pub runs: Option<u32>,
}

/// How a test that failed at least once behaved over the compared runs.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum FlakyTestKind {
    /// Failed and passed on the same commit (another run, or a retry within one run).
    Flaky,
    /// Went from passing to failing and back more than once.
    Unstable,
    /// Passed before, failed in every run since `sinceBuildNumber`.
    NewFailure,
    /// Failed in every run it was seen in.
    Consistent,
    /// Failed before, passes in the latest runs.
    Fixed,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FlakyTestStat {
    pub name: String,
    pub kind: FlakyTestKind,
    /// Runs in which the test failed.
    pub failed_runs: i64,
    /// Runs in which the test's outcome is known (failed or passed).
    pub observed_runs: i64,
    /// For `NewFailure`: the first run of the current failing streak.
    pub since_build_id: Option<i64>,
    pub since_build_number: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FlakyTestReport {
    /// Completed runs compared (runs that published tests).
    pub compared_runs: i64,
    /// Runs whose test results could not be fetched.
    pub skipped_runs: i64,
    /// Every test that failed at least once, worst signal first.
    pub tests: Vec<FlakyTestStat>,
}

/// One test run (test task) of a build, reduced to what the comparison needs.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct TestRunObservation {
    pub name: Option<String>,
    pub total: i64,
    pub failed: HashSet<String>,
    /// False when fewer failed results were fetched than the run reported, so
    /// a test missing from `failed` may still have failed.
    pub complete: bool,
}

/// The test outcome of one completed build.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct BuildObservation {
    pub build_id: i64,
    pub build_number: Option<String>,
    pub source_version: Option<String>,
    pub runs: Vec<TestRunObservation>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Outcome {
    Failed,
    Passed,
}

impl BuildObservation {
    fn has_tests(&self) -> bool {
        self.runs.iter().any(|run| run.total > 0)
    }

    fn failed(&self) -> impl Iterator<Item = &String> {
        self.runs.iter().flat_map(|run| run.failed.iter())
    }

    fn outcome(&self, test: &str) -> Option<Outcome> {
        if self.runs.iter().any(|run| run.failed.contains(test)) {
            return Some(Outcome::Failed);
        }
        if self.has_tests() && self.runs.iter().all(|run| run.complete) {
            return Some(Outcome::Passed);
        }
        None
    }

    /// True when the test failed in one run of this build and another run with
    /// the same name (a retried job) published tests without failing it.
    fn passed_on_retry(&self, test: &str) -> bool {
        self.runs.iter().any(|failed_run| {
            failed_run.failed.contains(test)
                && self.runs.iter().any(|other| {
                    !std::ptr::eq(other, failed_run)
                        && other.name.is_some()
                        && other.name == failed_run.name
                        && other.total > 0
                        && other.complete
                        && !other.failed.contains(test)
                })
        })
    }
}

/// Classifies every test that failed in `builds` (ordered oldest first).
pub(super) fn classify_flaky_tests(builds: &[BuildObservation]) -> Vec<FlakyTestStat> {
    let compared: Vec<&BuildObservation> = builds.iter().filter(|b| b.has_tests()).collect();
    let mut names: Vec<&String> = compared
        .iter()
        .copied()
        .flat_map(BuildObservation::failed)
        .collect();
    names.sort();
    names.dedup();

    let mut stats: Vec<FlakyTestStat> = names
        .into_iter()
        .map(|name| classify_one(name, &compared))
        .collect();
    stats.sort_by(|a, b| {
        rank(a.kind)
            .cmp(&rank(b.kind))
            .then(b.failed_runs.cmp(&a.failed_runs))
            .then(a.name.cmp(&b.name))
    });
    stats
}

fn rank(kind: FlakyTestKind) -> u8 {
    match kind {
        FlakyTestKind::Flaky => 0,
        FlakyTestKind::Unstable => 1,
        FlakyTestKind::NewFailure => 2,
        FlakyTestKind::Consistent => 3,
        FlakyTestKind::Fixed => 4,
    }
}

fn classify_one(name: &str, builds: &[&BuildObservation]) -> FlakyTestStat {
    let outcomes: Vec<(&BuildObservation, Outcome)> = builds
        .iter()
        .filter_map(|build| build.outcome(name).map(|outcome| (*build, outcome)))
        .collect();
    let failed_runs = outcomes
        .iter()
        .filter(|(_, outcome)| *outcome == Outcome::Failed)
        .count() as i64;

    let mut by_commit: HashMap<&str, (bool, bool)> = HashMap::new();
    for (build, outcome) in &outcomes {
        if let Some(commit) = build.source_version.as_deref() {
            let seen = by_commit.entry(commit).or_default();
            match outcome {
                Outcome::Failed => seen.0 = true,
                Outcome::Passed => seen.1 = true,
            }
        }
    }
    let same_commit = by_commit
        .values()
        .any(|(failed, passed)| *failed && *passed);
    let retried = builds.iter().any(|build| build.passed_on_retry(name));

    let transitions = outcomes
        .windows(2)
        .filter(|pair| pair[0].1 != pair[1].1)
        .count();
    let last = outcomes.last().map(|(_, outcome)| *outcome);
    let kind = if same_commit || retried {
        FlakyTestKind::Flaky
    } else if failed_runs == outcomes.len() as i64 {
        FlakyTestKind::Consistent
    } else if transitions >= 2 {
        FlakyTestKind::Unstable
    } else if last == Some(Outcome::Failed) {
        FlakyTestKind::NewFailure
    } else {
        FlakyTestKind::Fixed
    };

    let since = (kind == FlakyTestKind::NewFailure)
        .then(|| {
            outcomes
                .iter()
                .rev()
                .take_while(|(_, outcome)| *outcome == Outcome::Failed)
                .last()
                .map(|(build, _)| *build)
        })
        .flatten();
    FlakyTestStat {
        name: name.to_string(),
        kind,
        failed_runs,
        observed_runs: outcomes.len() as i64,
        since_build_id: since.map(|build| build.build_id),
        since_build_number: since.and_then(|build| build.build_number.clone()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(name: &str, total: i64, failed: &[&str]) -> TestRunObservation {
        TestRunObservation {
            name: Some(name.to_string()),
            total,
            failed: failed.iter().map(|t| t.to_string()).collect(),
            complete: true,
        }
    }

    fn build(id: i64, commit: &str, runs: Vec<TestRunObservation>) -> BuildObservation {
        BuildObservation {
            build_id: id,
            build_number: Some(format!("b{id}")),
            source_version: Some(commit.to_string()),
            runs,
        }
    }

    fn kind_of(stats: &[FlakyTestStat], name: &str) -> FlakyTestKind {
        stats.iter().find(|s| s.name == name).unwrap().kind
    }

    #[test]
    fn same_commit_fail_then_pass_is_flaky() {
        let builds = vec![
            build(1, "c1", vec![run("Unit", 10, &["A"])]),
            build(2, "c1", vec![run("Unit", 10, &[])]),
        ];
        let stats = classify_flaky_tests(&builds);
        assert_eq!(kind_of(&stats, "A"), FlakyTestKind::Flaky);
        assert_eq!(stats[0].failed_runs, 1);
        assert_eq!(stats[0].observed_runs, 2);
    }

    #[test]
    fn retried_job_within_one_build_is_flaky() {
        let builds = vec![build(
            1,
            "c1",
            vec![run("Unit", 10, &["A"]), run("Unit", 10, &[])],
        )];
        assert_eq!(
            kind_of(&classify_flaky_tests(&builds), "A"),
            FlakyTestKind::Flaky
        );
    }

    #[test]
    fn alternating_outcomes_are_unstable() {
        let builds = vec![
            build(1, "c1", vec![run("Unit", 10, &[])]),
            build(2, "c2", vec![run("Unit", 10, &["A"])]),
            build(3, "c3", vec![run("Unit", 10, &[])]),
        ];
        assert_eq!(
            kind_of(&classify_flaky_tests(&builds), "A"),
            FlakyTestKind::Unstable
        );
    }

    #[test]
    fn trailing_failures_after_passes_are_a_new_failure() {
        let builds = vec![
            build(1, "c1", vec![run("Unit", 10, &[])]),
            build(2, "c2", vec![run("Unit", 10, &["A"])]),
            build(3, "c3", vec![run("Unit", 10, &["A"])]),
        ];
        let stats = classify_flaky_tests(&builds);
        assert_eq!(stats[0].kind, FlakyTestKind::NewFailure);
        assert_eq!(stats[0].since_build_id, Some(2));
        assert_eq!(stats[0].since_build_number.as_deref(), Some("b2"));
    }

    #[test]
    fn always_failing_is_consistent_and_recovered_is_fixed() {
        let builds = vec![
            build(1, "c1", vec![run("Unit", 10, &["A", "B"])]),
            build(2, "c2", vec![run("Unit", 10, &["A"])]),
        ];
        let stats = classify_flaky_tests(&builds);
        assert_eq!(kind_of(&stats, "A"), FlakyTestKind::Consistent);
        assert_eq!(kind_of(&stats, "B"), FlakyTestKind::Fixed);
        assert_eq!(stats[0].name, "A", "consistent ranks above fixed");
    }

    #[test]
    fn incomplete_failed_lists_and_runs_without_tests_are_not_passes() {
        let mut capped = run("Unit", 10, &["X"]);
        capped.complete = false;
        let builds = vec![
            build(1, "c1", vec![run("Unit", 10, &["A"])]),
            build(2, "c1", vec![capped]),
            build(3, "c1", vec![run("Unit", 0, &[])]),
        ];
        let stats = classify_flaky_tests(&builds);
        let a = stats.iter().find(|s| s.name == "A").unwrap();
        assert_eq!(a.kind, FlakyTestKind::Consistent);
        assert_eq!(a.observed_runs, 1);
    }

    #[test]
    fn worst_signal_sorts_first() {
        let builds = vec![
            build(1, "c1", vec![run("Unit", 10, &["Z", "B"])]),
            build(2, "c1", vec![run("Unit", 10, &["B"])]),
        ];
        let stats = classify_flaky_tests(&builds);
        assert_eq!(stats[0].name, "Z");
        assert_eq!(stats[0].kind, FlakyTestKind::Flaky);
        assert_eq!(stats[1].kind, FlakyTestKind::Consistent);
    }
}
