# nightcape

A Bun CLI that drains a labelled GitHub issue queue overnight by spawning headless `claude -p` sessions per issue. Each session executes a pre-baked plan via the existing [superpowers](https://github.com/obra/superpowers) workflow (`executing-plans` + `subagent-driven-development` + `requesting-code-review` + `using-git-worktrees`). Auto-merges PRs that pass lint/build with a clean code review; leaves draft PRs for human review otherwise. Survives Max-plan rate-limits by sleeping until the window resets and resuming from persisted state.

The premise: the *creative* work is already done in your spec and plan. Overnight execution is mechanical — read plan, dispatch subagents, review, push. Claude can do this faithfully when started with the right prompt and skills.

## How it fits into the day

**By day** — write specs and plans using superpowers brainstorming, commit them, create GitHub issues labelled `nightcape` referencing the plan paths.

**By night** — run `nightcape start`. Wake up to merged commits and draft PRs awaiting review.

## Install

Requires `bun`, `git`, `gh` (authenticated), and the `claude` CLI with the superpowers plugin installed.

```bash
git clone <repo-url> ~/code/nightcape
cd ~/code/nightcape
bun install
bun run build       # produces dist/nightcape.js
```

To use `nightcape` as a global command, link the bin or alias `~/code/nightcape/bin/nightcape.ts`.

## Quickstart

From inside any target repo:

```bash
nightcape init       # scaffold .nightcape/config.json + add to .gitignore
nightcape doctor     # verify environment
nightcape start      # drain the issue queue (run before bed)
```

In the morning:

```bash
nightcape report     # latest morning report
gh pr list           # PRs awaiting review
git log --oneline    # what landed
```

## Configuration

`.nightcape/config.json` is created by `nightcape init` with these defaults:

```json
{
  "label": "nightcape",
  "default_model": "sonnet",
  "permission_mode": "dangerous",
  "lint": "bun run lint",
  "build": "bun run build",
  "worktrees_dir": "~/.nightcape/worktrees",
  "max_issues_per_run": 20,
  "blocking_severities": ["Critical", "Important"]
}
```

`label` — the GitHub issue label nightcape watches.
`default_model` — `sonnet` (default) or `opus`. Per-issue override via `nightcape:opus` label.
`permission_mode` — see [Safety](#safety) below.
`lint` / `build` — commands run by Claude inside each issue's worktree. Empty string skips.
`blocking_severities` — code-review severities that block auto-merge. Defaults to `Critical` + `Important` per the requesting-code-review skill's own guidance.

## Issue convention

An issue picked up by nightcape needs:
- The `nightcape` label
- A reference to a committed plan in its body, e.g. `Plan: docs/superpowers/plans/2026-04-25-user-search.md`

Optional per-issue labels:
- `nightcape:opus` — use Opus instead of the configured default model
- `nightcape:safe` — use `--permission-mode acceptEdits` instead of `--dangerously-skip-permissions`. Note: headless runs in this mode are likely to stall on permission prompts.

Issues are processed in ascending number order. Auto-merged PRs land back to `main` so chained issues see fresh code before they start.

## Safety

**nightcape spawns `claude` with `--dangerously-skip-permissions` by default.** This is required for headless overnight runs — without it, Claude stalls the moment it hits a non-allowlisted bash command, and `executing-plans` will absolutely run bash. There are two layers of mitigation:

1. **Worktree isolation.** Each issue runs in `~/.nightcape/worktrees/<repo>-issue-N/`, a dedicated git worktree. Your main checkout is never the cwd. Worktrees share `.git`, so this is not a hard sandbox; it is a strong default.
2. **Auto-merge gate.** Bad code can't reach `main` without `gh pr merge --squash --auto` waiting on required GitHub Actions checks. **Strongly recommended:** enable branch protection on `main` requiring CI to pass before merge. This is your second safety net and the one you should rely on if you don't trust nightcape.

There is no filesystem or network sandboxing. v1 trusts the same things you trust when *you* run Claude Code with `--dangerously-skip-permissions` yourself.

If a specific issue needs extra caution, label it `nightcape:safe` to opt out of dangerous mode for that issue only (at the cost of likely stalling the run).

## Auto-merge gate

A PR has auto-merge enabled only when *all* hold:
- Claude reported `status: "ready_to_merge"` in its final-JSON output
- Claude reported `lint_passed: true` and `build_passed: true`
- `review_findings` contains no entries with severity in `blocking_severities` (default `Critical` + `Important`)

When all three hold, nightcape calls `gh pr merge --squash --auto`. GitHub performs the merge once any branch-protection required checks pass. If they never pass, the PR sits indefinitely with auto-merge enabled — you find it in `gh pr list` in the morning.

If any gate fails: nightcape opens a draft PR, comments on the issue with the failure reason and a link to the run log, and moves on to the next issue.

## Commands

```
nightcape help                  Print available commands
nightcape doctor                Run preflight checks; non-zero exit on failure
nightcape init                  Scaffold .nightcape/config.json + .gitignore entry
nightcape start [--max N] [--dry-run]
                                Drain the queue. Acquires run.lock,
                                runs preflight, processes issues serially
nightcape status                Print current run state, queue remaining
nightcape stop                  Graceful SIGTERM (forwarded to claude;
                                30s grace; force-kill + needs_review on overrun)
nightcape reset [--archive]     Clear state.json. Refuses if nightcape is running
nightcape report [<date>]       Print the morning report for given date (default: latest)
```

Exit codes: `0` queue drained · `1` preflight/lock/config failure · `2` runtime error · `3` interrupted.

## What lives where

```
<repo>/
├── .nightcape/                  (gitignored)
│   ├── config.json              your nightcape config
│   ├── state.json               queue progress, atomic-written
│   ├── run.lock                 PID lockfile
│   ├── logs/issue-N-<ts>.log    one log per issue
│   └── runs/<date>.md           morning report
└── docs/superpowers/
    ├── specs/...                your design docs
    └── plans/...                your plans (referenced by issues)
```

## Resume semantics

`nightcape start` is idempotent under interruption:
- Persisted state lets a crashed nightcape pick up where it left off.
- A re-run with a fully-drained `state.json` archives it to `.nightcape/runs/<date>/state.json` and starts fresh.
- A re-run during an active rate-limit window sleeps the remaining time before resuming.

## Running overnight

`nightcape start` runs in the foreground. To survive your terminal closing, wrap it:

```bash
nohup nightcape start > /tmp/nightcape.log 2>&1 &
```

Or use `tmux` / `screen` if you want to attach in the morning.

## Known limitations (v0.1.0)

- **No log streaming.** Per-issue logs are written when Claude exits, not as it runs. A crashed orchestrator before Claude's exit leaves no log.
- **Single repo per invocation.** Run multiple nightcape instances in separate terminals if you must.
- **Single machine.** The lockfile prevents concurrent runs in one repo, but there's no coordination across machines.
- **English-only rate-limit detection.** Localized error messages from `claude` will fall through to the generic failure path.
- **No container sandbox.** Worktree boundary only.

See `docs/superpowers/specs/2026-04-29-nightcape-design.md` for the full design and explicit non-goals.

## Testing

```bash
bun test           # 91 tests across 16 files
bun run lint       # tsc --noEmit
bun run build      # bundled binary at dist/nightcape.js
```

Every external dependency (`gh`, `git`, `claude`, `fs`, `clock`) is dependency-injected, so the orchestrator test suite never touches real subprocesses.
