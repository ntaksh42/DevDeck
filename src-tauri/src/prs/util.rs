use azdo_client::{AdoError, IdentityRefWithVote};

// Active PRs across one project; well above what a project realistically has.
pub(crate) const PROJECT_PR_SYNC_TOP: u32 = 500;

// PRs where the user is a reviewer, queried per project for the review cache.
pub(crate) const REVIEW_PR_SYNC_TOP: u32 = 200;

pub(crate) fn short_ref(value: &str) -> String {
    value
        .strip_prefix("refs/heads/")
        .unwrap_or(value)
        .to_string()
}

pub(crate) fn vote_label(vote: i32) -> &'static str {
    match vote {
        10 => "Approved",
        5 => "Approved w/ Suggestions",
        0 => "No Vote",
        -5 => "Waiting",
        -10 => "Rejected",
        _ => "No Vote",
    }
}

/// Resolves the authenticated user's (vote, is_required) for a PR. The user may
/// be a direct individual reviewer, or a reviewer only via a group/team. A group
/// reviewer rolls up its members' votes into `voted_for`; if the user voted that
/// way, surface their vote and treat them as required when the group is required.
/// Falls back to (No Vote, not required) when the user is not found — note a
/// group member who has not voted does not appear in `voted_for`, so that case
/// is not detectable from PR data alone.
pub(crate) fn resolve_reviewer_vote(
    reviewers: &[IdentityRefWithVote],
    user_id: &str,
) -> (i32, bool) {
    if let Some(direct) = reviewers.iter().find(|r| r.id.as_deref() == Some(user_id)) {
        return (direct.vote, direct.is_required);
    }
    reviewers
        .iter()
        .find_map(|group| {
            group
                .voted_for
                .as_deref()?
                .iter()
                .find(|member| member.id.as_deref() == Some(user_id))
                .map(|member| (member.vote, group.is_required))
        })
        .unwrap_or((0, false))
}

pub(crate) fn is_ado_not_found(error: &AdoError) -> bool {
    matches!(error, AdoError::Api { status: 404, .. })
}
