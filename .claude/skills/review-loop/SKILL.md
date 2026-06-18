---
name: review-loop
description: >-
  Review open GitHub pull requests in the azdo-dashboard repository against this
  project's review guidelines, then post the findings back to each PR as a
  GitHub review with inline comments. Use this skill whenever the user asks to
  review open PRs, check the PR queue, audit pending pull requests, or run a
  review pass — especially when running it on a schedule via `/loop` to keep the
  PR backlog reviewed at a regular cadence. Trigger it even if the user only says
  "review the PRs", "look at what's open", or "babysit the review queue" without
  naming this skill.
---

# review-loop

Review the open pull requests in this repository (`ntaksh42/azdo-dashboard`)
against the project's review guidelines, and leave the findings on each PR as a
GitHub review.

This skill defines **one review pass**: find the PRs that still need review,
review each one, post the results. To run it on a schedule, the user combines it
with `/loop` (e.g. `/loop 30m /review-loop`). You do not manage the timer
yourself — each invocation is a single pass and should be idempotent so repeated
runs don't pile up duplicate comments.

## Review guidelines

The project-specific things to look for live in
[references/review-guidelines.md](references/review-guidelines.md). Read that
file before reviewing — it encodes the IPC contract, runtime boundaries, secret
handling, keyboard-operability, and other rules that a generic reviewer would
miss. Your review is only useful if it catches violations of *these* rules, not
just generic style nits.

## Workflow

### 1. Find PRs that still need a review pass

List open, non-draft PRs:

```bash
gh pr list --state open --json number,title,author,isDraft,updatedAt \
  --jq '[.[] | select(.isDraft == false)]'
```

Skip a PR when you have already reviewed its current state. To check, look at
whether your own review is newer than the last push:

```bash
# last commit time on the PR head
gh pr view <N> --json commits --jq '.commits[-1].committedDate'
# your existing reviews (look for ones authored by the current gh user)
gh pr view <N> --json reviews --jq '.reviews[] | {author: .author.login, submittedAt, state}'
```

If your most recent review is **newer** than the last commit, the PR hasn't
changed since you reviewed it — skip it and say so. This is what keeps a
scheduled `/loop` from re-reviewing the same unchanged PR every cycle. Only
review PRs that are new or have been pushed to since your last pass.

If every open PR is already up to date, report that there's nothing to review
and stop. Don't invent findings to look busy.

### 2. Gather context for each PR to review

```bash
gh pr view <N> --json number,title,body,author,baseRefName,headRefName,files
gh pr diff <N>
```

Read the actual diff, not just the description. Map each changed file to the
relevant section of the guidelines (e.g. a change under `src-tauri/src/` that
touches a `#[tauri::command]` pulls in the four-part IPC contract; a change to a
popover or menu pulls in the keyboard-operability rules).

### 3. Review against the guidelines

Form findings by checking the diff against
[references/review-guidelines.md](references/review-guidelines.md). For each
finding, note the file and line so it can be posted inline. Prefer a small
number of high-signal findings over a long list of nitpicks — a reviewer the
team trusts is one that doesn't cry wolf.

Classify each finding:

- **blocking** — correctness bug, broken runtime path, secret leak, missing half
  of the IPC contract, a mouse-only interactive element. These should block
  merge.
- **suggestion** — a real improvement that isn't strictly blocking.
- **nit** — minor; prefix the comment with `nit:` so the author can triage fast.

### 4. Post the review to the PR

Post as a single GitHub review so the inline comments are grouped, not as a
scatter of loose comments. Build a review JSON and submit it via the API:

```bash
gh api repos/ntaksh42/azdo-dashboard/pulls/<N>/reviews \
  --method POST \
  --input review.json
```

Where `review.json` looks like:

```json
{
  "commit_id": "<HEAD sha of the PR>",
  "event": "COMMENT",
  "body": "review-loop pass — <one-line summary>",
  "comments": [
    {
      "path": "src-tauri/src/prs.rs",
      "line": 42,
      "side": "RIGHT",
      "body": "blocking: this command isn't registered in generate_handler![], so the invoke() will fail at runtime. See AGENTS.md IPC contract step 1."
    }
  ]
}
```

Get the HEAD sha with `gh pr view <N> --json headRefOid --jq '.headRefOid'`.
Use `"event": "COMMENT"` rather than `REQUEST_CHANGES` or `APPROVE` — an
automated cadence reviewer should inform, not gate, unless the user explicitly
asks it to approve/block. Inline `comments` must reference lines that appear in
the diff; for findings that aren't tied to a specific line, put them in the
top-level `body`.

Always lead the review `body` with `review-loop pass —` so passes are
identifiable and the user can tell automated reviews apart from human ones.

### 5. Report back

Summarize what you did in the conversation: which PRs you reviewed, which you
skipped (and why — e.g. "already reviewed, unchanged"), and the headline finding
per PR. Keep it short; the detail lives on the PRs.

## Notes

- This skill posts to live PRs. Posting a GitHub review is outward-facing — it
  notifies the author. That's the intended behavior here (the user asked for
  comments to be posted), so proceed without re-confirming each pass, but never
  post `APPROVE`/`REQUEST_CHANGES` unless the user asked for it.
- If `gh` is not authenticated (`gh auth status` fails), stop and tell the user;
  don't try to work around it.
- Stay within this repository. Don't review PRs in other repos even if the user
  is in a different directory.
