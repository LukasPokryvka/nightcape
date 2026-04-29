# nightcape — overnight superpowers executor

**Date:** 2026-04-29
**Status:** Design (approved by user, pending spec review)

## Summary

A Bun CLI that drains a queue of GitHub issues by spawning headless Claude Code sessions, one per issue, while the user sleeps. Each session executes a pre-baked plan via the existing superpowers workflow (`executing-plans` + `subagent-driven-development` + `requesting-code-review` + `using-git-worktrees`). Auto-merges PRs that pass lint/build with a clean code review; leaves draft PRs for human review otherwise. Survives session-cap rate-limits by sleeping until the window resets and resuming from persisted state.

## Why

The user already runs a disciplined day workflow: superpowers brainstorming → spec → plan → GitHub issue with the plan committed and referenced. By night, the Claude Max plan goes underused. Existing tools (e.g. `claude-queue`) run prompts but don't trigger the superpowers flow — no subagent-driven-development, no code review pass, no per-issue worktree isolation, no auto-merge gate.

Nightcape's premise: the *creative* work is already done in the spec and plan. Overnight execution is mechanical — read plan, dispatch subagents, review, push. Claude is more than capable of doing this faithfully when started with the right prompt and skills.

## Goals

- Drain a label-filtered GitHub issue queue overnight, one issue at a time.
- Faithfully invoke the existing superpowers execution flow per issue; nightcape itself does no LLM reasoning.
- Auto-merge PRs that pass strict gates so chained issues see a fresh `main`.
- Survive Max-plan rate-limits by sleeping and resuming.
- Persist queue state so a crash or reboot doesn't lose overnight progress.
- Produce a morning report the user can read in 30 seconds and triage.
- Bill against Max plan only — no Anthropic API key path.

## Non-goals (v1)

- Multi-machine / distributed runs.
- Container / sandbox isolation. Worktree boundary only.
- Multi-repo per invocation.
- Inter-issue dependency graphs (order is label-ordered issue number ascending).
- Brainstorming or planning by night. Execution only.
- Scheduling — user runs `nightcape start` themselves; cron/launchd is their concern.
- API-key billing fallback.
- Plugin/hook extensibility surface in nightcape itself (extensibility lives in superpowers skills).
- Notifications beyond the on-disk morning report (no Slack, email, osascript).
- Web UI / TUI.

## Architecture

Three layers of responsibility:

| Layer | Implementation | Knows about |
|---|---|---|
| **Orchestrator** | `src/orchestrator.ts` (Bun) | GitHub issues, queue order, run state, lint/build gate, PR creation, auto-merge, rate-limit waits |
| **Prompt builder** | `src/prompt.ts` (Bun) | Issue body, plan-reference convention, model choice, permission mode |
| **Executor** | spawned `claude -p` | Reads the plan, runs `executing-plans` + `subagent-driven-development` + `requesting-code-review` + `using-git-worktrees`, runs lint/build, pushes the branch, emits a final JSON status block |

**Process model.** Single long-running parent. Sequential, no concurrency. Loops over the queue and `await`s a `claude -p` subprocess per issue. The parent never touches the repo's working tree directly — repo work happens inside per-issue git worktrees the executor creates and tears down.

**Why split this way.** The orchestrator stays small, deterministic, and unit-testable (no LLM calls in tests). The Claude session is where superpowers run. Nightcape doesn't reimplement *any* of the dev flow; it just kicks off Claude with the right prompt and waits.

**Hard constraint.** The orchestrator does not make Anthropic API calls itself. All model usage flows through `claude -p`, which bills against the Max plan, not against an API key. This is what makes "Max plan only" a structural property and not a discipline.

**Dependencies (external):** `bun`, `git`, `gh` (authenticated), `claude` CLI with superpowers plugin installed.

## Per-issue lifecycle

```
┌──────────────────────────────────────────────────────────────────┐
│ 1. Pull next issue                                               │
│    gh issue list --label nightcape --state open --json ...       │
│    Pick lowest-numbered issue NOT in state.completed             │
│    Mark state.in_progress = #N, persist .nightcape/state.json    │
│                                                                  │
│ 2. Pick model                                                    │
│    Default sonnet. Issue label "nightcape:opus" → opus.          │
│                                                                  │
│ 3. Update local main                                             │
│    git fetch origin                                              │
│                                                                  │
│ 4. Spawn headless Claude                                         │
│    claude -p --model <m> --print \                               │
│      [--dangerously-skip-permissions]   # config-controlled      │
│      < <prompt for issue #N>                                     │
│    Prompt instructs Claude to:                                   │
│      • Read issue #N body, find the plan reference, read plan    │
│      • Create a git worktree (using-git-worktrees)               │
│      • Execute plan (executing-plans + subagent-driven-dev)      │
│      • Run requesting-code-review at completion                  │
│      • Run repo's lint + build commands; report results          │
│      • Push branch as nightcape/issue-N                          │
│      • Emit final JSON status block (see step 6)                 │
│                                                                  │
│ 5. Watch for cap / failure                                       │
│    Stream stdout to .nightcape/logs/issue-N-<ts>.log             │
│    On stderr "rate_limit_exceeded" → set rate_limit_until,       │
│      sleep until reset, requeue same issue                       │
│    On non-zero exit → mark issue failed, draft PR, next          │
│                                                                  │
│ 6. Parse Claude's final JSON status                              │
│    {                                                             │
│      status: "ready_to_merge" | "needs_review" | "failed",       │
│      branch: "nightcape/issue-12",                               │
│      lint_passed: true,                                          │
│      build_passed: true,                                         │
│      review_findings: [{severity, summary}, ...],                │
│      summary: "..."                                              │
│    }                                                             │
│    Falls back to "needs_review" if parsing fails.                │
│                                                                  │
│ 7. Decide outcome (orchestrator, NOT Claude)                     │
│    if ready_to_merge && lint && build &&                         │
│       no Critical/Important review findings:                     │
│         gh pr create --title "..." --body "Closes #N"            │
│         gh pr merge <pr> --squash --auto                         │
│         outcome = "auto_merged"                                  │
│    else:                                                         │
│         gh pr create --draft --title "WIP: nightcape #N ..."     │
│         gh issue comment N -F failure-summary.md                 │
│         outcome = "needs_review"                                 │
│                                                                  │
│ 8. Append to morning report, persist state, loop to step 1       │
└──────────────────────────────────────────────────────────────────┘
```

Two load-bearing details:

1. **The orchestrator owns the gate, not Claude.** Claude reports facts ("lint passed", "review found 2 Minor"); the orchestrator decides whether to auto-merge. Claude shouldn't be able to talk itself into merging by being optimistic.
2. **The final-JSON contract.** The prompt instructs Claude to end its output with a fenced ` ```json ` block matching the schema in step 6. This is the only structured I/O between orchestrator and executor; everything else is free-form log output.

## Auto-merge gate

A PR has auto-merge enabled only when *all* of these hold:
- Claude reported `status: "ready_to_merge"` in the final JSON.
- Claude reported `lint_passed: true` and `build_passed: true`.
- `review_findings` contains no findings whose severity is in the configured blocking-severities set (default: `Critical`, `Important`). Severity vocabulary comes from the `requesting-code-review` skill, which categorizes findings as `Critical` (must fix), `Important` (should fix), and `Minor` (nice to have). Default matches the skill's own guidance ("Fix Critical issues immediately. Fix Important issues before proceeding").

When all three hold, nightcape calls `gh pr merge --squash --auto`, which *queues* the merge with GitHub. GitHub performs the merge once any branch-protection required checks pass. If they never pass, the PR sits indefinitely with auto-merge enabled — the user finds it in `gh pr list` in the morning. Nightcape considers its job done when the call succeeds; it does not wait for GitHub to actually finalize the merge.

The three local gates are layered intentionally: nightcape fails closed if any one is unsure. Tests are *not* in nightcape's gate per user decision; if a plan needs tests, the executor still runs them as part of executing-plans, but their result doesn't block the auto-merge enable. (CI's required-checks list, if configured, *does* block the actual merge — that is the recommended belt-and-suspenders setup.)

**Hard rule:** never `--no-verify`, never force-push, never delete a remote branch, never bypass branch protection. If `gh pr merge --auto` itself errors (e.g. PR has merge conflicts at queue time, branch is missing required reviewers and `--auto` is unsupported), the PR is created as draft and the issue is marked `needs_review`.

## Permission mode and safety

Headless overnight runs require no permission prompts, so nightcape spawns `claude` with `--dangerously-skip-permissions` by default. Mitigations:

1. **Worktree isolation as blast-radius boundary.** Each issue runs in `~/.nightcape/worktrees/<repo>-issue-N/`, a dedicated git worktree. The user's main checkout is never the cwd. Worktrees share `.git`, so this is not a hard sandbox; it is a strong default.
2. **Auto-merge gate as second safety layer.** Bad code can't reach `main` without `gh pr merge --auto` waiting on required GitHub Actions checks. README will recommend branch protection on `main` requiring CI green.
3. **No filesystem or network sandboxing.** v1 trusts the same things the user trusts when running Claude Code with `--dangerously-skip-permissions` themselves. Container isolation is a future-v2 idea.

Per-issue overrides via labels:
- `nightcape:opus` — use Opus for this issue (default Sonnet).
- `nightcape:safe` — force `--permission-mode acceptEdits` for this issue. `nightcape doctor` warns this mode is likely to stall headless runs.

## Configuration

`.nightcape/config.json` at the repo root:

```jsonc
{
  "label": "nightcape",
  "default_model": "sonnet",
  "permission_mode": "dangerous",   // "dangerous" | "acceptEdits" | "default"
  "lint": "bun run lint",
  "build": "bun run build",
  "worktrees_dir": "~/.nightcape/worktrees",
  "max_issues_per_run": 20,
  "blocking_severities": ["Critical", "Important"]
}
```

`nightcape init` scaffolds this file with sensible defaults and adds `.nightcape/` to `.gitignore`. Re-runs only top up missing fields.

`lint` or `build` set to `""` skips that step (still required to be present in the file). If a command is configured but doesn't exist on PATH, `nightcape doctor` fails.

## State and storage

Everything lives at `<repo>/.nightcape/` (gitignored):

```
<repo>/
├── .nightcape/
│   ├── config.json
│   ├── state.json
│   ├── run.lock                        # PID lockfile, prevents concurrent runs
│   ├── logs/
│   │   ├── issue-12-2026-04-29T22-14-03.log
│   │   └── issue-13-2026-04-29T23-41-08.log
│   └── runs/
│       └── 2026-04-29.md
└── .gitignore
```

`state.json` schema (atomic write: temp + rename):

```jsonc
{
  "version": 1,
  "run_id": "2026-04-29T22-00-00",
  "started_at": "2026-04-29T22:00:00Z",
  "queue_snapshot": [12, 13, 14, 15],
  "in_progress": null,
  "completed": [
    { "issue": 12, "outcome": "auto_merged",  "branch": "nightcape/issue-12",
      "pr": 47, "duration_sec": 612, "model": "sonnet" },
    { "issue": 13, "outcome": "needs_review", "branch": "nightcape/issue-13",
      "pr": 48, "reason": "code-review found 1 Critical finding",
      "model": "sonnet" }
  ],
  "rate_limit_until": null
}
```

**Resume semantics.** Re-running `nightcape start` with state present:
- If `in_progress` is set, that issue is requeued at the front. The executor checks for an existing `nightcape/issue-N` branch and continues rather than restarts. Honest tradeoff: Claude isn't fully idempotent; a retry may produce messy commit history on a draft PR you'd review anyway.
- If `rate_limit_until` is in the future, sleep the difference, then proceed.
- A new day → user runs `nightcape reset` to clear, or nightcape auto-archives `state.json` → `runs/<date>/state.json` when the queue drains.

**Run lock.** `nightcape start` writes `.nightcape/run.lock` containing the PID. A second `start` invocation refuses if the lock exists and the PID is alive. Stale lockfiles (PID gone) are reaped on next start with a warning.

**Branch naming.** `nightcape/issue-N`.

## Morning report

`runs/<date>.md`, appended after each issue (so a crashed nightcape leaves a useful partial report):

```md
# nightcape run 2026-04-29

Started: 22:00 · Ended: 04:18 · Duration: 6h18m
Issues processed: 4 · Auto-merged: 2 · Needs review: 1 · Failed: 1

## #12 — Add user search endpoint        ✅ auto-merged
- branch: nightcape/issue-12 · PR #47 · sonnet · 10m12s
- lint: ✓ build: ✓ review: clean

## #13 — Refactor auth middleware         🟡 needs review
- branch: nightcape/issue-13 · PR #48 (draft) · sonnet · 18m
- code-review found 1 Critical finding (token-leak risk)
- log: .nightcape/logs/issue-13-2026-04-29T23-41-08.log
```

The report is designed to be inhaled by a morning Claude Code session: "read last night's nightcape report and summarize what needs my attention."

## CLI surface

```
nightcape help                  Print available commands.
nightcape doctor                Run preflight checks; non-zero exit on failure.
nightcape init                  Scaffold .nightcape/config.json + .gitignore entry.
nightcape start [--max N] [--dry-run]
                                Drain the queue. Acquires run.lock, runs preflight,
                                processes issues per the lifecycle above.
nightcape status                Print current run state, queue remaining, rate-limit ETA.
nightcape stop                  Graceful shutdown (SIGTERM forwarded to claude;
                                up to 30s grace; force-kill + needs_review on overrun).
nightcape reset [--archive]     Clear state.json. Refuses if nightcape is running.
nightcape report [<date>]       Print the morning report for given date (default: latest).
```

`--help` and `-h` aliases for `help`.

**Exit codes:** `0` queue drained · `1` preflight failed · `2` runtime error · `3` interrupted.

## Preflight (`nightcape doctor`)

Runs at startup of `nightcape start` and standalone via `nightcape doctor`. Per-check pass/fail with remediation hints. Checks:

- `bun` on PATH and version ≥ supported.
- `git` on PATH; cwd is a git repo with at least one remote.
- `gh` on PATH; `gh auth status` returns authenticated.
- `claude` on PATH; superpowers plugin installed and discoverable.
- Network reachability: `gh api user` succeeds.
- `.nightcape/config.json` exists and parses; `lint` and `build` commands resolve (`which` or `bun run --dry`).
- If `permission_mode != "dangerous"`: emit a warning that headless runs in this mode are likely to stall.
- No stale `run.lock` blocking a new start.

Hard-fails fast with actionable messages. Better at 22:00 than at 03:00.

## Failure handling

On any of: Claude exits non-zero · final JSON unparseable · `status: "failed"` · `status: "ready_to_merge"` but lint/build failed · review found `Critical` or `Important` findings · `gh pr merge --auto` rejected:

1. Push whatever exists on `nightcape/issue-N` (skip if no commits).
2. `gh pr create --draft --title "WIP: nightcape #N <title>" --body <failure summary>`.
3. `gh issue comment N -F failure-summary.md` with: outcome, branch, PR link, log path, brief reason.
4. Mark `state.completed += { issue: N, outcome: "needs_review" or "failed", reason, ... }`.
5. Continue with the next issue. The queue does not halt on a single failure.

There is no automatic Sonnet→Opus escalation on retry. Issues most likely to fail twice are the ones we don't want to spend Opus budget on.

## Testing strategy

Three layers, scaled to value:

- **Unit tests** (Bun's built-in runner). Every external dep (`gh`, `git`, `claude`, `fs`, `clock`) goes behind a small interface with a fake for tests. The fake `claude` returns scripted outputs (success / rate-limit / failure / malformed-JSON / cap-mid-stream) to exercise every branch of the lifecycle deterministically. Target ≥80% coverage on the orchestrator. Prompt-builder gets snapshot tests.
- **Integration test against a sandbox repo** (manual / CI-optional). One toy plan + one issue in a fixture repo, real `gh` against a throwaway repo or recorded HTTP fixtures. Run-on-demand.
- **Manual e2e** via `nightcape start --dry-run` + a single real issue on a personal repo before each release.

What we don't test: the executor (Claude) itself. Nightcape tests the contract: "given Claude returned this final JSON, did the orchestrator do the right thing?"

## Open questions / future work

- **Container isolation (v2).** Spawn the executor inside a Docker container with the worktree mounted read-write. Hard sandbox replacing the worktree-only soft boundary.
- **Notifications.** macOS push via `osascript`, then optional Slack/email. ~10 lines each, deferred.
- **Multi-repo runs.** A meta-orchestrator that walks a list of repos. Not v1.
- **Inter-issue dependency declarations.** Currently order = issue number; explicit `Depends on:` is a possible v2 if the user finds label-order insufficient.
- **API-key fallback.** If usefulness emerges, an `--api-key` flag could spawn `claude` with API billing for runs that exceed Max. Not v1.
