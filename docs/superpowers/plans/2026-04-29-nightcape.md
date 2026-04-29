# nightcape Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Bun CLI that drains a labelled GitHub issue queue overnight by spawning headless `claude -p` sessions per issue, gating auto-merge on lint/build/code-review, and surviving Max-plan rate-limits via persisted state.

**Architecture:** Three layers — orchestrator (Bun, deterministic), prompt builder, executor (`claude -p` subprocess that runs the existing superpowers flow). All shell-outs (`gh`, `git`, `claude`) live behind injected runner interfaces so the orchestrator is unit-testable with fakes. Companion spec: `docs/superpowers/specs/2026-04-29-nightcape-design.md`.

**Tech Stack:** Bun (TypeScript runtime + `bun:test`), `gh` CLI, `git`, `claude` CLI with the superpowers plugin.

---

## File map (lock from this point on)

- `bin/nightcape.ts` — entry shebang
- `src/cli.ts` — argv parser + command dispatch
- `src/types.ts` — Config, State, FinalJSON, ReviewFinding, Outcome, Issue
- `src/config.ts` — load / validate / scaffold `.nightcape/config.json`
- `src/state.ts` — atomic load/save `.nightcape/state.json`
- `src/lock.ts` — acquire/release `.nightcape/run.lock`
- `src/parse.ts` — extract + validate final-JSON from claude stdout
- `src/gates.ts` — pure decision function: auto_merge | needs_review
- `src/prompt.ts` — build per-issue prompt
- `src/report.ts` — append per-issue entry to morning report
- `src/orchestrator.ts` — per-issue lifecycle loop
- `src/runners/types.ts` — GhRunner / GitRunner / ClaudeRunner interfaces
- `src/runners/gh.ts` — real gh wrapper
- `src/runners/git.ts` — real git wrapper
- `src/runners/claude.ts` — real claude wrapper with rate-limit detection
- `src/commands/{help,doctor,init,start,status,stop,reset,report}.ts`
- `tests/fakes/runners.ts` — in-memory fakes
- `tests/fakes/fixtures.ts` — sample issues / plans / outputs
- `tests/*.test.ts` — one per src module

**Convention:** all modules export functions, no classes. State lives in arguments and return values, never in module-level vars (single exception: `bin/nightcape.ts` reading argv).

---

## Task 1: Project scaffolding + minimal CLI with `help`

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `bin/nightcape.ts`
- Create: `src/cli.ts`
- Create: `src/commands/help.ts`
- Create: `tests/cli.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/cli.test.ts`:
```ts
import { test, expect } from "bun:test";
import { runCli } from "../src/cli";

test("runCli with no args prints help and exits 0", async () => {
  const result = await runCli([]);
  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain("nightcape");
  expect(result.stdout).toContain("help");
  expect(result.stdout).toContain("doctor");
  expect(result.stdout).toContain("start");
});

test("runCli with --help prints help", async () => {
  const result = await runCli(["--help"]);
  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain("nightcape");
});

test("runCli with unknown command exits 1 with hint", async () => {
  const result = await runCli(["bogus"]);
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("unknown command");
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test tests/cli.test.ts
```
Expected: FAIL — `Cannot find module '../src/cli'`.

- [ ] **Step 3: Create package.json**

```json
{
  "name": "nightcape",
  "version": "0.0.1",
  "type": "module",
  "bin": { "nightcape": "./bin/nightcape.ts" },
  "scripts": {
    "test": "bun test",
    "lint": "tsc --noEmit",
    "build": "bun build ./bin/nightcape.ts --target=bun --outfile=dist/nightcape.js"
  },
  "devDependencies": {
    "@types/bun": "latest",
    "typescript": "^5"
  }
}
```

- [ ] **Step 4: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "types": ["bun-types"],
    "lib": ["ES2022"],
    "resolveJsonModule": true
  },
  "include": ["bin", "src", "tests"]
}
```

- [ ] **Step 5: Create src/commands/help.ts**

```ts
export const HELP_TEXT = `nightcape — overnight superpowers executor

Usage: nightcape <command> [options]

Commands:
  help                Print this help text
  doctor              Run preflight checks
  init                Scaffold .nightcape/config.json
  start [--max N] [--dry-run]
                      Drain the issue queue
  status              Print current run state
  stop                Gracefully stop a running nightcape
  reset [--archive]   Clear state.json
  report [<date>]     Print morning report

Run 'nightcape doctor' before your first 'nightcape start'.
`;

export async function helpCommand(): Promise<{ stdout: string; exitCode: number }> {
  return { stdout: HELP_TEXT, exitCode: 0 };
}
```

- [ ] **Step 6: Create src/cli.ts**

```ts
import { helpCommand } from "./commands/help";

export type CliResult = { stdout: string; stderr: string; exitCode: number };

export async function runCli(argv: string[]): Promise<CliResult> {
  const command = argv[0] ?? "help";

  if (command === "help" || command === "--help" || command === "-h") {
    const { stdout, exitCode } = await helpCommand();
    return { stdout, stderr: "", exitCode };
  }

  return {
    stdout: "",
    stderr: `nightcape: unknown command '${command}'\nRun 'nightcape help' for usage.\n`,
    exitCode: 1,
  };
}
```

- [ ] **Step 7: Create bin/nightcape.ts**

```ts
#!/usr/bin/env bun
import { runCli } from "../src/cli";

const result = await runCli(Bun.argv.slice(2));
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
process.exit(result.exitCode);
```

- [ ] **Step 8: Run tests + lint**

```bash
chmod +x bin/nightcape.ts
bun install
bun test tests/cli.test.ts
bun run lint
```
Expected: all 3 cli tests PASS, tsc reports no errors.

- [ ] **Step 9: Manual smoke test**

```bash
bun run bin/nightcape.ts
bun run bin/nightcape.ts --help
bun run bin/nightcape.ts bogus
```
Expected: first two print help text; third prints "unknown command 'bogus'" to stderr and exits 1.

- [ ] **Step 10: Commit**

```bash
git add package.json tsconfig.json bin/ src/ tests/
git commit -m "feat: scaffold Bun project with CLI dispatch and help command"
```

---

## Task 2: Shared types

**Files:**
- Create: `src/types.ts`
- Create: `src/runners/types.ts`

No tests — these are type-only declarations. Type errors caught by `bun run lint` in subsequent tasks.

- [ ] **Step 1: Create src/types.ts**

```ts
export type Severity = "Critical" | "Important" | "Minor";

export type ReviewFinding = {
  severity: Severity;
  summary: string;
  file?: string;
  line?: number;
};

export type FinalJsonStatus = "ready_to_merge" | "needs_review" | "failed";

export type FinalJson = {
  status: FinalJsonStatus;
  branch: string;
  lint_passed: boolean;
  build_passed: boolean;
  review_findings: ReviewFinding[];
  summary: string;
};

export type Config = {
  label: string;
  default_model: "sonnet" | "opus";
  permission_mode: "dangerous" | "acceptEdits" | "default";
  lint: string;
  build: string;
  worktrees_dir: string;
  max_issues_per_run: number;
  blocking_severities: Severity[];
};

export type Outcome = "auto_merged" | "needs_review" | "failed";

export type CompletedEntry = {
  issue: number;
  outcome: Outcome;
  branch: string;
  pr?: number;
  duration_sec: number;
  model: "sonnet" | "opus";
  reason?: string;
};

export type State = {
  version: 1;
  run_id: string;
  started_at: string;            // ISO
  queue_snapshot: number[];
  in_progress: number | null;
  completed: CompletedEntry[];
  rate_limit_until: string | null; // ISO or null
};

export type Issue = {
  number: number;
  title: string;
  body: string;
  labels: string[];
};
```

- [ ] **Step 2: Create src/runners/types.ts**

```ts
import type { Issue } from "../types";

export type GhRunner = {
  authStatus(): Promise<{ ok: boolean; message: string }>;
  listIssuesByLabel(label: string): Promise<Issue[]>;
  getIssue(n: number): Promise<Issue>;
  commentIssue(n: number, body: string): Promise<void>;
  createPr(opts: {
    title: string;
    body: string;
    head: string;
    base: string;
    draft: boolean;
  }): Promise<{ number: number; url: string }>;
  mergePrSquashAuto(n: number): Promise<{ ok: boolean; message: string }>;
};

export type GitRunner = {
  isRepo(): Promise<boolean>;
  hasRemote(): Promise<boolean>;
  fetch(remote: string): Promise<void>;
  revParse(ref: string): Promise<string>;
  branchExists(name: string): Promise<boolean>;
};

export type ClaudeRunResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationSec: number;
  rateLimited: boolean;
  rateLimitUntil: string | null; // ISO if parseable
};

export type ClaudeRunner = {
  version(): Promise<string>;
  hasSuperpowers(): Promise<boolean>;
  run(opts: {
    prompt: string;
    model: "sonnet" | "opus";
    permissionMode: "dangerous" | "acceptEdits" | "default";
    cwd: string;
    logPath: string;             // stream stdout here line-by-line
    onSignalCheck?: () => "stop" | null; // poll for graceful stop
  }): Promise<ClaudeRunResult>;
};
```

- [ ] **Step 3: Verify it compiles**

```bash
bun run lint
```
Expected: PASS (no errors). Existing cli.test still PASS.

- [ ] **Step 4: Commit**

```bash
git add src/types.ts src/runners/types.ts
git commit -m "feat: add shared types and runner interfaces"
```

---

## Task 3: Test fakes

**Files:**
- Create: `tests/fakes/runners.ts`
- Create: `tests/fakes/fixtures.ts`
- Create: `tests/fakes/runners.test.ts` (sanity-test the fakes themselves)

- [ ] **Step 1: Create tests/fakes/fixtures.ts**

```ts
import type { Issue, FinalJson } from "../../src/types";

export const ISSUE_12: Issue = {
  number: 12,
  title: "Add user search endpoint",
  body: `Add the search endpoint per the plan.

Plan: docs/superpowers/plans/2026-04-25-user-search.md
`,
  labels: ["nightcape"],
};

export const ISSUE_13_OPUS: Issue = {
  number: 13,
  title: "Refactor auth middleware",
  body: "Plan: docs/superpowers/plans/2026-04-25-auth.md",
  labels: ["nightcape", "nightcape:opus"],
};

export const FINAL_JSON_READY: FinalJson = {
  status: "ready_to_merge",
  branch: "nightcape/issue-12",
  lint_passed: true,
  build_passed: true,
  review_findings: [],
  summary: "Implemented user search; tests green; review clean.",
};

export const FINAL_JSON_REVIEW_BLOCKED: FinalJson = {
  status: "ready_to_merge",
  branch: "nightcape/issue-13",
  lint_passed: true,
  build_passed: true,
  review_findings: [
    { severity: "Critical", summary: "Token leaked in logs", file: "auth.ts", line: 42 },
  ],
  summary: "Review blocked by token-leak finding.",
};

export const FINAL_JSON_LINT_FAILED: FinalJson = {
  status: "ready_to_merge",
  branch: "nightcape/issue-14",
  lint_passed: false,
  build_passed: true,
  review_findings: [],
  summary: "Lint failed; please review.",
};

export function claudeOutputWith(json: FinalJson): string {
  return `Doing the work...
Step 1 done.
Step 2 done.

\`\`\`json
${JSON.stringify(json, null, 2)}
\`\`\`
`;
}

export const CLAUDE_RATE_LIMIT_STDERR =
  "Error: rate_limit_exceeded — usage cap reached. Reset at 2026-04-30T03:00:00Z.";
```

- [ ] **Step 2: Create tests/fakes/runners.ts**

```ts
import type { GhRunner, GitRunner, ClaudeRunner, ClaudeRunResult } from "../../src/runners/types";
import type { Issue } from "../../src/types";

type Recorded = { method: string; args: unknown[] };

export class FakeGh implements GhRunner {
  calls: Recorded[] = [];
  authOk = true;
  issues: Issue[] = [];
  prCounter = 100;
  prMergeAcceptedFor: Set<number> = new Set();

  async authStatus() {
    this.calls.push({ method: "authStatus", args: [] });
    return { ok: this.authOk, message: this.authOk ? "ok" : "not authenticated" };
  }
  async listIssuesByLabel(label: string) {
    this.calls.push({ method: "listIssuesByLabel", args: [label] });
    return this.issues.filter(i => i.labels.includes(label));
  }
  async getIssue(n: number) {
    this.calls.push({ method: "getIssue", args: [n] });
    const i = this.issues.find(x => x.number === n);
    if (!i) throw new Error(`issue ${n} not found`);
    return i;
  }
  async commentIssue(n: number, body: string) {
    this.calls.push({ method: "commentIssue", args: [n, body] });
  }
  async createPr(opts: { title: string; body: string; head: string; base: string; draft: boolean }) {
    this.calls.push({ method: "createPr", args: [opts] });
    const number = this.prCounter++;
    return { number, url: `https://github.com/test/repo/pull/${number}` };
  }
  async mergePrSquashAuto(n: number) {
    this.calls.push({ method: "mergePrSquashAuto", args: [n] });
    if (this.prMergeAcceptedFor.has(n)) return { ok: true, message: "queued" };
    return { ok: false, message: "branch protection rejects merge" };
  }
}

export class FakeGit implements GitRunner {
  calls: Recorded[] = [];
  repoOk = true;
  remoteOk = true;
  branches = new Set<string>();
  refs: Record<string, string> = { HEAD: "deadbeef", "origin/main": "deadbeef" };

  async isRepo() { this.calls.push({ method: "isRepo", args: [] }); return this.repoOk; }
  async hasRemote() { this.calls.push({ method: "hasRemote", args: [] }); return this.remoteOk; }
  async fetch(remote: string) { this.calls.push({ method: "fetch", args: [remote] }); }
  async revParse(ref: string) {
    this.calls.push({ method: "revParse", args: [ref] });
    const sha = this.refs[ref];
    if (!sha) throw new Error(`unknown ref ${ref}`);
    return sha;
  }
  async branchExists(name: string) {
    this.calls.push({ method: "branchExists", args: [name] });
    return this.branches.has(name);
  }
}

export type ScriptedClaudeResponse = Partial<ClaudeRunResult> & { stdout: string };

export class FakeClaude implements ClaudeRunner {
  calls: Recorded[] = [];
  superpowersInstalled = true;
  versionString = "claude 1.0.0";
  responses: ScriptedClaudeResponse[] = [];

  async version() { this.calls.push({ method: "version", args: [] }); return this.versionString; }
  async hasSuperpowers() { this.calls.push({ method: "hasSuperpowers", args: [] }); return this.superpowersInstalled; }
  async run(opts: Parameters<ClaudeRunner["run"]>[0]): Promise<ClaudeRunResult> {
    this.calls.push({ method: "run", args: [opts] });
    const next = this.responses.shift();
    if (!next) throw new Error("FakeClaude: no scripted response remaining");
    return {
      stdout: next.stdout,
      stderr: next.stderr ?? "",
      exitCode: next.exitCode ?? 0,
      durationSec: next.durationSec ?? 1,
      rateLimited: next.rateLimited ?? false,
      rateLimitUntil: next.rateLimitUntil ?? null,
    };
  }
}
```

- [ ] **Step 3: Write the failing test for the fakes themselves**

`tests/fakes/runners.test.ts`:
```ts
import { test, expect } from "bun:test";
import { FakeGh, FakeGit, FakeClaude } from "./runners";
import { ISSUE_12, claudeOutputWith, FINAL_JSON_READY } from "./fixtures";

test("FakeGh listIssuesByLabel filters by label", async () => {
  const gh = new FakeGh();
  gh.issues = [ISSUE_12];
  const got = await gh.listIssuesByLabel("nightcape");
  expect(got).toEqual([ISSUE_12]);
  expect(gh.calls.at(-1)?.method).toBe("listIssuesByLabel");
});

test("FakeGh mergePrSquashAuto returns ok only if PR pre-approved", async () => {
  const gh = new FakeGh();
  gh.prMergeAcceptedFor.add(101);
  expect((await gh.mergePrSquashAuto(101)).ok).toBe(true);
  expect((await gh.mergePrSquashAuto(102)).ok).toBe(false);
});

test("FakeClaude returns scripted responses in order, throws when empty", async () => {
  const c = new FakeClaude();
  c.responses = [{ stdout: claudeOutputWith(FINAL_JSON_READY), exitCode: 0 }];
  const r = await c.run({ prompt: "x", model: "sonnet", permissionMode: "dangerous", cwd: ".", logPath: "/tmp/x" });
  expect(r.exitCode).toBe(0);
  expect(r.stdout).toContain("ready_to_merge");
  await expect(
    c.run({ prompt: "y", model: "sonnet", permissionMode: "dangerous", cwd: ".", logPath: "/tmp/y" }),
  ).rejects.toThrow("no scripted response");
});

test("FakeGit revParse throws on unknown ref", async () => {
  const g = new FakeGit();
  await expect(g.revParse("nope")).rejects.toThrow("unknown ref");
});
```

- [ ] **Step 4: Run tests**

```bash
bun test tests/fakes/runners.test.ts
bun run lint
```
Expected: 4 fake-runner tests PASS, lint clean.

- [ ] **Step 5: Commit**

```bash
git add tests/fakes/
git commit -m "test: add in-memory runner fakes and fixtures"
```

---

## Task 4: Config module

**Files:**
- Create: `src/config.ts`
- Create: `tests/config.test.ts`

- [ ] **Step 1: Write the failing tests**

`tests/config.test.ts`:
```ts
import { test, expect } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, scaffoldConfig, DEFAULT_CONFIG, type LoadResult } from "../src/config";

function tmp(): string {
  return mkdtempSync(join(tmpdir(), "nc-"));
}

test("loadConfig: missing file returns { ok: false, reason: 'missing' }", () => {
  const dir = tmp();
  const r = loadConfig(dir);
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.reason).toBe("missing");
  rmSync(dir, { recursive: true });
});

test("loadConfig: malformed JSON returns ok:false reason:'parse'", () => {
  const dir = tmp();
  writeFileSync(join(dir, ".nightcape", "config.json"), "{broken", { flag: "wx" });
  const r = loadConfig(dir);
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.reason).toBe("parse");
  rmSync(dir, { recursive: true });
});

test("loadConfig: missing required field returns ok:false reason:'invalid'", () => {
  const dir = tmp();
  const ncDir = join(dir, ".nightcape");
  Bun.write(join(ncDir, "config.json"), JSON.stringify({ label: "x" }));
  const r = loadConfig(dir);
  expect(r.ok).toBe(false);
  if (!r.ok) {
    expect(r.reason).toBe("invalid");
    expect(r.errors!.length).toBeGreaterThan(0);
  }
  rmSync(dir, { recursive: true });
});

test("loadConfig: valid file returns ok:true with parsed config", async () => {
  const dir = tmp();
  await Bun.write(join(dir, ".nightcape", "config.json"), JSON.stringify(DEFAULT_CONFIG));
  const r = loadConfig(dir);
  expect(r.ok).toBe(true);
  if (r.ok) expect(r.config).toEqual(DEFAULT_CONFIG);
  rmSync(dir, { recursive: true });
});

test("scaffoldConfig: writes defaults, idempotent (tops up missing fields only)", async () => {
  const dir = tmp();
  scaffoldConfig(dir);
  expect(existsSync(join(dir, ".nightcape", "config.json"))).toBe(true);
  // Hand-edit one field, scaffold again, ensure custom value preserved
  const path = join(dir, ".nightcape", "config.json");
  const existing = JSON.parse(readFileSync(path, "utf8"));
  existing.label = "custom";
  await Bun.write(path, JSON.stringify(existing));
  scaffoldConfig(dir);
  const after = JSON.parse(readFileSync(path, "utf8"));
  expect(after.label).toBe("custom");
  expect(after.default_model).toBe(DEFAULT_CONFIG.default_model);
  rmSync(dir, { recursive: true });
});
```

- [ ] **Step 2: Run tests to verify failure**

```bash
bun test tests/config.test.ts
```
Expected: FAIL — `Cannot find module '../src/config'`.

- [ ] **Step 3: Implement src/config.ts**

```ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Config, Severity } from "./types";

export const DEFAULT_CONFIG: Config = {
  label: "nightcape",
  default_model: "sonnet",
  permission_mode: "dangerous",
  lint: "bun run lint",
  build: "bun run build",
  worktrees_dir: "~/.nightcape/worktrees",
  max_issues_per_run: 20,
  blocking_severities: ["Critical", "Important"],
};

export type LoadResult =
  | { ok: true; config: Config }
  | { ok: false; reason: "missing" | "parse" | "invalid"; errors?: string[] };

const VALID_MODELS = new Set(["sonnet", "opus"]);
const VALID_PERMS = new Set(["dangerous", "acceptEdits", "default"]);
const VALID_SEVS = new Set<Severity>(["Critical", "Important", "Minor"]);

function validate(raw: unknown): { ok: true; config: Config } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!raw || typeof raw !== "object") return { ok: false, errors: ["config is not an object"] };
  const o = raw as Record<string, unknown>;

  const need = (key: keyof Config) => {
    if (!(key in o)) errors.push(`missing field: ${String(key)}`);
  };
  (["label","default_model","permission_mode","lint","build","worktrees_dir","max_issues_per_run","blocking_severities"] as const).forEach(need);
  if (errors.length) return { ok: false, errors };

  if (typeof o.label !== "string") errors.push("label must be string");
  if (!VALID_MODELS.has(o.default_model as string)) errors.push("default_model must be 'sonnet'|'opus'");
  if (!VALID_PERMS.has(o.permission_mode as string)) errors.push("permission_mode must be 'dangerous'|'acceptEdits'|'default'");
  if (typeof o.lint !== "string") errors.push("lint must be string");
  if (typeof o.build !== "string") errors.push("build must be string");
  if (typeof o.worktrees_dir !== "string") errors.push("worktrees_dir must be string");
  if (typeof o.max_issues_per_run !== "number" || (o.max_issues_per_run as number) < 1) errors.push("max_issues_per_run must be a positive number");
  if (!Array.isArray(o.blocking_severities) || (o.blocking_severities as unknown[]).some(s => !VALID_SEVS.has(s as Severity))) {
    errors.push("blocking_severities must be an array of 'Critical'|'Important'|'Minor'");
  }
  if (errors.length) return { ok: false, errors };

  return { ok: true, config: o as unknown as Config };
}

export function loadConfig(repoRoot: string): LoadResult {
  const path = join(repoRoot, ".nightcape", "config.json");
  if (!existsSync(path)) return { ok: false, reason: "missing" };
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    return { ok: false, reason: "parse" };
  }
  const v = validate(raw);
  if (!v.ok) return { ok: false, reason: "invalid", errors: v.errors };
  return { ok: true, config: v.config };
}

export function scaffoldConfig(repoRoot: string): void {
  const ncDir = join(repoRoot, ".nightcape");
  if (!existsSync(ncDir)) mkdirSync(ncDir, { recursive: true });
  const path = join(ncDir, "config.json");
  let existing: Partial<Config> = {};
  if (existsSync(path)) {
    try { existing = JSON.parse(readFileSync(path, "utf8")); } catch { existing = {}; }
  }
  const merged: Config = { ...DEFAULT_CONFIG, ...existing };
  writeFileSync(path, JSON.stringify(merged, null, 2) + "\n");
}
```

- [ ] **Step 4: Run tests + lint**

```bash
bun test tests/config.test.ts
bun run lint
```
Expected: 5 config tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/config.ts tests/config.test.ts
git commit -m "feat: config load + scaffold with validation"
```

---

## Task 5: State module with atomic writes

**Files:**
- Create: `src/state.ts`
- Create: `tests/state.test.ts`

- [ ] **Step 1: Write the failing tests**

`tests/state.test.ts`:
```ts
import { test, expect } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  initState, loadState, saveState, markInProgress,
  recordCompletion, setRateLimit, archiveState,
} from "../src/state";
import type { State } from "../src/types";

const tmp = () => mkdtempSync(join(tmpdir(), "nc-"));

test("loadState: missing returns null", () => {
  const dir = tmp();
  expect(loadState(dir)).toBeNull();
  rmSync(dir, { recursive: true });
});

test("initState writes a fresh state with queue snapshot", () => {
  const dir = tmp();
  const s = initState(dir, [12, 13, 14]);
  expect(s.queue_snapshot).toEqual([12, 13, 14]);
  expect(s.in_progress).toBeNull();
  expect(s.completed).toEqual([]);
  expect(s.rate_limit_until).toBeNull();
  expect(existsSync(join(dir, ".nightcape", "state.json"))).toBe(true);
  rmSync(dir, { recursive: true });
});

test("markInProgress + recordCompletion round-trip via saveState/loadState", () => {
  const dir = tmp();
  let s = initState(dir, [12, 13]);
  s = markInProgress(s, 12);
  saveState(dir, s);
  s = loadState(dir)!;
  expect(s.in_progress).toBe(12);

  s = recordCompletion(s, {
    issue: 12, outcome: "auto_merged", branch: "nightcape/issue-12",
    pr: 47, duration_sec: 612, model: "sonnet",
  });
  saveState(dir, s);
  s = loadState(dir)!;
  expect(s.in_progress).toBeNull();
  expect(s.completed).toHaveLength(1);
  expect(s.completed[0]!.issue).toBe(12);
  rmSync(dir, { recursive: true });
});

test("setRateLimit stores ISO timestamp", () => {
  const dir = tmp();
  let s = initState(dir, [12]);
  s = setRateLimit(s, "2026-04-30T03:00:00Z");
  expect(s.rate_limit_until).toBe("2026-04-30T03:00:00Z");
  rmSync(dir, { recursive: true });
});

test("saveState writes atomically (temp + rename)", () => {
  const dir = tmp();
  const s: State = {
    version: 1, run_id: "r1", started_at: new Date().toISOString(),
    queue_snapshot: [1], in_progress: null, completed: [], rate_limit_until: null,
  };
  saveState(dir, s);
  // No temp file should remain
  expect(existsSync(join(dir, ".nightcape", "state.json.tmp"))).toBe(false);
  expect(existsSync(join(dir, ".nightcape", "state.json"))).toBe(true);
  rmSync(dir, { recursive: true });
});

test("archiveState moves state.json into runs/<date>/", () => {
  const dir = tmp();
  initState(dir, [1]);
  archiveState(dir, "2026-04-29");
  expect(existsSync(join(dir, ".nightcape", "state.json"))).toBe(false);
  expect(existsSync(join(dir, ".nightcape", "runs", "2026-04-29", "state.json"))).toBe(true);
  rmSync(dir, { recursive: true });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
bun test tests/state.test.ts
```
Expected: FAIL — module missing.

- [ ] **Step 3: Implement src/state.ts**

```ts
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { State, CompletedEntry } from "./types";

const STATE_REL = ".nightcape/state.json";

function statePath(repoRoot: string): string {
  return join(repoRoot, STATE_REL);
}

function ensureDir(p: string): void {
  if (!existsSync(p)) mkdirSync(p, { recursive: true });
}

export function loadState(repoRoot: string): State | null {
  const path = statePath(repoRoot);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as State;
}

export function saveState(repoRoot: string, state: State): void {
  const path = statePath(repoRoot);
  ensureDir(dirname(path));
  const tmp = path + ".tmp";
  writeFileSync(tmp, JSON.stringify(state, null, 2) + "\n");
  renameSync(tmp, path);
}

export function initState(repoRoot: string, queue: number[]): State {
  const now = new Date();
  const runId = now.toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const state: State = {
    version: 1,
    run_id: runId,
    started_at: now.toISOString(),
    queue_snapshot: [...queue],
    in_progress: null,
    completed: [],
    rate_limit_until: null,
  };
  saveState(repoRoot, state);
  return state;
}

export function markInProgress(state: State, issue: number | null): State {
  return { ...state, in_progress: issue };
}

export function recordCompletion(state: State, entry: CompletedEntry): State {
  return {
    ...state,
    in_progress: null,
    completed: [...state.completed, entry],
  };
}

export function setRateLimit(state: State, untilIso: string | null): State {
  return { ...state, rate_limit_until: untilIso };
}

export function archiveState(repoRoot: string, dateLabel: string): void {
  const src = statePath(repoRoot);
  if (!existsSync(src)) return;
  const dstDir = join(repoRoot, ".nightcape", "runs", dateLabel);
  ensureDir(dstDir);
  renameSync(src, join(dstDir, "state.json"));
}
```

- [ ] **Step 4: Run tests + lint**

```bash
bun test tests/state.test.ts
bun run lint
```
Expected: 6 state tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/state.ts tests/state.test.ts
git commit -m "feat: persistent state with atomic writes and archive"
```

---

## Task 6: PID lockfile

**Files:**
- Create: `src/lock.ts`
- Create: `tests/lock.test.ts`

- [ ] **Step 1: Write the failing tests**

`tests/lock.test.ts`:
```ts
import { test, expect } from "bun:test";
import { mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireLock, releaseLock, isLockHeld } from "../src/lock";

const tmp = () => mkdtempSync(join(tmpdir(), "nc-"));

test("acquireLock writes PID and isLockHeld is true", () => {
  const dir = tmp();
  const r = acquireLock(dir, () => true);
  expect(r.acquired).toBe(true);
  expect(isLockHeld(dir, () => true)).toBe(true);
  rmSync(dir, { recursive: true });
});

test("acquireLock fails if a live PID already holds it", () => {
  const dir = tmp();
  mkdirSync(join(dir, ".nightcape"));
  writeFileSync(join(dir, ".nightcape", "run.lock"), "12345\n");
  const r = acquireLock(dir, () => true); // pretend pid 12345 is alive
  expect(r.acquired).toBe(false);
  expect(r.heldByPid).toBe(12345);
  rmSync(dir, { recursive: true });
});

test("acquireLock reaps stale lock (PID dead) with a warning", () => {
  const dir = tmp();
  mkdirSync(join(dir, ".nightcape"));
  writeFileSync(join(dir, ".nightcape", "run.lock"), "99999\n");
  const r = acquireLock(dir, () => false); // pid dead
  expect(r.acquired).toBe(true);
  expect(r.reaped).toBe(true);
  rmSync(dir, { recursive: true });
});

test("releaseLock removes the lockfile", () => {
  const dir = tmp();
  acquireLock(dir, () => true);
  releaseLock(dir);
  expect(existsSync(join(dir, ".nightcape", "run.lock"))).toBe(false);
  rmSync(dir, { recursive: true });
});

test("isLockHeld returns false when file missing", () => {
  const dir = tmp();
  expect(isLockHeld(dir, () => true)).toBe(false);
  rmSync(dir, { recursive: true });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
bun test tests/lock.test.ts
```
Expected: FAIL — module missing.

- [ ] **Step 3: Implement src/lock.ts**

```ts
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const LOCK_REL = ".nightcape/run.lock";

function lockPath(repoRoot: string): string { return join(repoRoot, LOCK_REL); }

function readPid(path: string): number | null {
  try {
    const raw = readFileSync(path, "utf8").trim();
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch { return null; }
}

export type AcquireResult = { acquired: true; reaped?: boolean } | { acquired: false; heldByPid: number };

export type IsAliveFn = (pid: number) => boolean;

export function defaultIsAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

export function acquireLock(repoRoot: string, isAlive: IsAliveFn = defaultIsAlive): AcquireResult {
  const dir = join(repoRoot, ".nightcape");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const path = lockPath(repoRoot);
  let reaped = false;
  if (existsSync(path)) {
    const pid = readPid(path);
    if (pid !== null && isAlive(pid)) return { acquired: false, heldByPid: pid };
    // stale — reap
    unlinkSync(path);
    reaped = true;
  }
  writeFileSync(path, String(process.pid) + "\n", { flag: "wx" });
  return reaped ? { acquired: true, reaped: true } : { acquired: true };
}

export function releaseLock(repoRoot: string): void {
  const path = lockPath(repoRoot);
  if (existsSync(path)) {
    try { unlinkSync(path); } catch { /* best-effort */ }
  }
}

export function isLockHeld(repoRoot: string, isAlive: IsAliveFn = defaultIsAlive): boolean {
  const path = lockPath(repoRoot);
  if (!existsSync(path)) return false;
  const pid = readPid(path);
  return pid !== null && isAlive(pid);
}
```

- [ ] **Step 4: Run tests + lint**

```bash
bun test tests/lock.test.ts
bun run lint
```
Expected: 5 lock tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lock.ts tests/lock.test.ts
git commit -m "feat: PID lockfile with stale-reap"
```

---

## Task 7: Final-JSON parser

**Files:**
- Create: `src/parse.ts`
- Create: `tests/parse.test.ts`

- [ ] **Step 1: Write the failing tests**

`tests/parse.test.ts`:
```ts
import { test, expect } from "bun:test";
import { parseFinalJson } from "../src/parse";
import { claudeOutputWith, FINAL_JSON_READY, FINAL_JSON_REVIEW_BLOCKED } from "./fakes/fixtures";

test("parses a single ```json block at end of stdout", () => {
  const r = parseFinalJson(claudeOutputWith(FINAL_JSON_READY));
  expect(r).toEqual(FINAL_JSON_READY);
});

test("returns the LAST ```json block when multiple appear", () => {
  const stdout = `\`\`\`json
{ "noise": true }
\`\`\`
some text
${claudeOutputWith(FINAL_JSON_REVIEW_BLOCKED)}`;
  const r = parseFinalJson(stdout);
  expect(r).toEqual(FINAL_JSON_REVIEW_BLOCKED);
});

test("returns null on missing block", () => {
  expect(parseFinalJson("just text, no json")).toBeNull();
});

test("returns null on malformed JSON inside block", () => {
  expect(parseFinalJson("```json\n{ broken,\n```")).toBeNull();
});

test("returns null when JSON parses but schema is invalid", () => {
  const stdout = '```json\n{ "status": "weird" }\n```';
  expect(parseFinalJson(stdout)).toBeNull();
});

test("review_findings defaults to empty array if absent and otherwise valid", () => {
  const stdout = `\`\`\`json
{
  "status": "ready_to_merge",
  "branch": "nightcape/issue-12",
  "lint_passed": true,
  "build_passed": true,
  "summary": "ok"
}
\`\`\``;
  const r = parseFinalJson(stdout);
  expect(r?.review_findings).toEqual([]);
});
```

- [ ] **Step 2: Run to verify failure**

```bash
bun test tests/parse.test.ts
```
Expected: FAIL — module missing.

- [ ] **Step 3: Implement src/parse.ts**

```ts
import type { FinalJson, ReviewFinding, Severity } from "./types";

const VALID_STATUS = new Set(["ready_to_merge", "needs_review", "failed"]);
const VALID_SEV = new Set<Severity>(["Critical", "Important", "Minor"]);

const FENCE_RE = /```json\s*\n([\s\S]*?)\n```/g;

export function parseFinalJson(stdout: string): FinalJson | null {
  const matches = [...stdout.matchAll(FENCE_RE)];
  if (matches.length === 0) return null;
  const last = matches[matches.length - 1]!;
  const raw = last[1] ?? "";
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return null; }
  if (!parsed || typeof parsed !== "object") return null;
  const o = parsed as Record<string, unknown>;

  if (!VALID_STATUS.has(o.status as string)) return null;
  if (typeof o.branch !== "string" || o.branch.length === 0) return null;
  if (typeof o.lint_passed !== "boolean") return null;
  if (typeof o.build_passed !== "boolean") return null;
  if (typeof o.summary !== "string") return null;

  let findings: ReviewFinding[] = [];
  if (o.review_findings !== undefined) {
    if (!Array.isArray(o.review_findings)) return null;
    for (const f of o.review_findings as unknown[]) {
      if (!f || typeof f !== "object") return null;
      const fo = f as Record<string, unknown>;
      if (!VALID_SEV.has(fo.severity as Severity)) return null;
      if (typeof fo.summary !== "string") return null;
      findings.push({
        severity: fo.severity as Severity,
        summary: fo.summary,
        file: typeof fo.file === "string" ? fo.file : undefined,
        line: typeof fo.line === "number" ? fo.line : undefined,
      });
    }
  }

  return {
    status: o.status as FinalJson["status"],
    branch: o.branch,
    lint_passed: o.lint_passed,
    build_passed: o.build_passed,
    review_findings: findings,
    summary: o.summary,
  };
}
```

- [ ] **Step 4: Run tests + lint**

```bash
bun test tests/parse.test.ts
bun run lint
```
Expected: 6 parse tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/parse.ts tests/parse.test.ts
git commit -m "feat: tolerant parser for claude final-JSON status block"
```

---

## Task 8: Auto-merge gate decision

**Files:**
- Create: `src/gates.ts`
- Create: `tests/gates.test.ts`

- [ ] **Step 1: Write the failing tests**

`tests/gates.test.ts`:
```ts
import { test, expect } from "bun:test";
import { decideOutcome } from "../src/gates";
import { DEFAULT_CONFIG } from "../src/config";
import {
  FINAL_JSON_READY, FINAL_JSON_REVIEW_BLOCKED, FINAL_JSON_LINT_FAILED,
} from "./fakes/fixtures";

test("auto_merge when status=ready, lint+build pass, no blocking findings", () => {
  expect(decideOutcome(FINAL_JSON_READY, DEFAULT_CONFIG)).toEqual({ outcome: "auto_merged" });
});

test("needs_review when status=ready but lint failed", () => {
  const r = decideOutcome(FINAL_JSON_LINT_FAILED, DEFAULT_CONFIG);
  expect(r.outcome).toBe("needs_review");
  expect(r.reason).toContain("lint");
});

test("needs_review when status=ready but a Critical finding present", () => {
  const r = decideOutcome(FINAL_JSON_REVIEW_BLOCKED, DEFAULT_CONFIG);
  expect(r.outcome).toBe("needs_review");
  expect(r.reason).toContain("Critical");
});

test("needs_review when status=needs_review regardless of lint/build", () => {
  const r = decideOutcome({ ...FINAL_JSON_READY, status: "needs_review" }, DEFAULT_CONFIG);
  expect(r.outcome).toBe("needs_review");
});

test("failed when status=failed", () => {
  const r = decideOutcome({ ...FINAL_JSON_READY, status: "failed", summary: "broke" }, DEFAULT_CONFIG);
  expect(r.outcome).toBe("failed");
  expect(r.reason).toContain("broke");
});

test("Minor findings do not block when blocking_severities=[Critical,Important]", () => {
  const fj = { ...FINAL_JSON_READY, review_findings: [{ severity: "Minor" as const, summary: "nit" }] };
  expect(decideOutcome(fj, DEFAULT_CONFIG).outcome).toBe("auto_merged");
});

test("custom blocking_severities=[Minor] makes Minor findings block", () => {
  const fj = { ...FINAL_JSON_READY, review_findings: [{ severity: "Minor" as const, summary: "nit" }] };
  const cfg = { ...DEFAULT_CONFIG, blocking_severities: ["Minor"] as const };
  expect(decideOutcome(fj, { ...cfg }).outcome).toBe("needs_review");
});

test("null FinalJson (parse failure) returns needs_review with reason", () => {
  expect(decideOutcome(null, DEFAULT_CONFIG)).toEqual({
    outcome: "needs_review",
    reason: "claude did not emit a parseable final-JSON status block",
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
bun test tests/gates.test.ts
```
Expected: FAIL — module missing.

- [ ] **Step 3: Implement src/gates.ts**

```ts
import type { FinalJson, Config, Outcome } from "./types";

export type Decision = { outcome: Outcome; reason?: string };

export function decideOutcome(fj: FinalJson | null, cfg: Config): Decision {
  if (fj === null) {
    return { outcome: "needs_review", reason: "claude did not emit a parseable final-JSON status block" };
  }
  if (fj.status === "failed") {
    return { outcome: "failed", reason: fj.summary || "claude reported failed" };
  }
  if (fj.status === "needs_review") {
    return { outcome: "needs_review", reason: fj.summary || "claude reported needs_review" };
  }
  // status === "ready_to_merge"
  if (!fj.lint_passed) return { outcome: "needs_review", reason: "lint failed" };
  if (!fj.build_passed) return { outcome: "needs_review", reason: "build failed" };

  const blocking = new Set(cfg.blocking_severities);
  const blockers = fj.review_findings.filter(f => blocking.has(f.severity));
  if (blockers.length > 0) {
    const counts = countBy(blockers, f => f.severity);
    const summary = Object.entries(counts).map(([sev, n]) => `${n} ${sev}`).join(", ");
    return { outcome: "needs_review", reason: `code-review found ${summary} finding(s)` };
  }
  return { outcome: "auto_merged" };
}

function countBy<T, K extends string>(arr: T[], keyFn: (x: T) => K): Record<K, number> {
  const out = {} as Record<K, number>;
  for (const x of arr) {
    const k = keyFn(x);
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}
```

- [ ] **Step 4: Run tests + lint**

```bash
bun test tests/gates.test.ts
bun run lint
```
Expected: 8 gate tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/gates.ts tests/gates.test.ts
git commit -m "feat: pure gate decision for auto-merge vs needs_review"
```

---

## Task 9: Prompt builder

**Files:**
- Create: `src/prompt.ts`
- Create: `tests/prompt.test.ts`

The prompt is the contract with the executor. It must instruct Claude to:
- Read the issue body, find a referenced plan, read it
- Use a fresh git worktree
- Execute the plan via `executing-plans` + `subagent-driven-development`
- Run `requesting-code-review` at completion
- Run repo's lint + build commands and report their pass/fail
- Push the branch as `nightcape/issue-N`
- Emit a final ` ```json ` block matching the FinalJson schema

- [ ] **Step 1: Write the failing tests**

`tests/prompt.test.ts`:
```ts
import { test, expect } from "bun:test";
import { buildPrompt } from "../src/prompt";
import { ISSUE_12, ISSUE_13_OPUS } from "./fakes/fixtures";
import { DEFAULT_CONFIG } from "../src/config";

test("buildPrompt includes issue number, title, body verbatim", () => {
  const p = buildPrompt({ issue: ISSUE_12, model: "sonnet", config: DEFAULT_CONFIG });
  expect(p).toContain("Issue #12");
  expect(p).toContain("Add user search endpoint");
  expect(p).toContain("docs/superpowers/plans/2026-04-25-user-search.md");
});

test("buildPrompt names the branch nightcape/issue-N", () => {
  const p = buildPrompt({ issue: ISSUE_12, model: "sonnet", config: DEFAULT_CONFIG });
  expect(p).toContain("nightcape/issue-12");
});

test("buildPrompt instructs Claude to invoke the named superpowers skills", () => {
  const p = buildPrompt({ issue: ISSUE_12, model: "sonnet", config: DEFAULT_CONFIG });
  expect(p).toContain("executing-plans");
  expect(p).toContain("subagent-driven-development");
  expect(p).toContain("requesting-code-review");
  expect(p).toContain("using-git-worktrees");
});

test("buildPrompt embeds the configured lint and build commands", () => {
  const p = buildPrompt({ issue: ISSUE_12, model: "sonnet", config: DEFAULT_CONFIG });
  expect(p).toContain(DEFAULT_CONFIG.lint);
  expect(p).toContain(DEFAULT_CONFIG.build);
});

test("buildPrompt embeds the FinalJson schema verbatim and severity vocabulary", () => {
  const p = buildPrompt({ issue: ISSUE_12, model: "sonnet", config: DEFAULT_CONFIG });
  expect(p).toContain('"status"');
  expect(p).toContain("ready_to_merge");
  expect(p).toContain("needs_review");
  expect(p).toContain("Critical");
  expect(p).toContain("Important");
  expect(p).toContain("Minor");
});

test("buildPrompt skips lint/build instructions when commands are empty strings", () => {
  const cfg = { ...DEFAULT_CONFIG, lint: "", build: "" };
  const p = buildPrompt({ issue: ISSUE_12, model: "sonnet", config: cfg });
  expect(p).toContain('"lint_passed": true   // no lint configured');
  expect(p).toContain('"build_passed": true');
});

test("buildPrompt is deterministic for same inputs (snapshot)", () => {
  const a = buildPrompt({ issue: ISSUE_12, model: "sonnet", config: DEFAULT_CONFIG });
  const b = buildPrompt({ issue: ISSUE_12, model: "sonnet", config: DEFAULT_CONFIG });
  expect(a).toBe(b);
});
```

- [ ] **Step 2: Run to verify failure**

```bash
bun test tests/prompt.test.ts
```
Expected: FAIL — module missing.

- [ ] **Step 3: Implement src/prompt.ts**

```ts
import type { Config, Issue } from "./types";

export type BuildPromptArgs = {
  issue: Issue;
  model: "sonnet" | "opus";
  config: Config;
};

export function buildPrompt({ issue, model, config }: BuildPromptArgs): string {
  const branch = `nightcape/issue-${issue.number}`;
  const lintBlock = config.lint
    ? `Run the lint command: \`${config.lint}\`. Capture pass/fail in lint_passed.`
    : `No lint command is configured. Set "lint_passed": true   // no lint configured`;
  const buildBlock = config.build
    ? `Run the build command: \`${config.build}\`. Capture pass/fail in build_passed.`
    : `No build command is configured. Set "build_passed": true   // no build configured`;

  return `You are nightcape's overnight executor for a single GitHub issue.

# Issue #${issue.number}: ${issue.title}

\`\`\`
${issue.body}
\`\`\`

# Your job (do all of it, in this order)

1. Read the issue body above. It references a plan (a markdown file under docs/). Read that plan in full.
2. Use the **using-git-worktrees** skill to create a fresh worktree. Branch name: \`${branch}\`.
3. Inside the worktree, execute the plan using **executing-plans** + **subagent-driven-development**. Make commits as you go (small, frequent).
4. ${lintBlock}
5. ${buildBlock}
6. Run **requesting-code-review** on your final commit range. Capture findings as an array of { severity, summary, file?, line? }, where severity is exactly "Critical", "Important", or "Minor".
7. Push the branch \`${branch}\` to origin.
8. Decide the status:
   - "ready_to_merge" if the work is complete and you believe a maintainer would merge it
   - "needs_review" if work is complete but you have reservations (or steps couldn't be fully verified)
   - "failed" if you could not complete the work

# Output contract (mandatory)

End your output with a single \`\`\`json\`\`\` fenced block matching this schema EXACTLY:

\`\`\`json
{
  "status": "ready_to_merge" | "needs_review" | "failed",
  "branch": "${branch}",
  "lint_passed": true,
  "build_passed": true,
  "review_findings": [
    { "severity": "Critical" | "Important" | "Minor", "summary": "...", "file": "path", "line": 42 }
  ],
  "summary": "one paragraph"
}
\`\`\`

If you do not emit this block, nightcape will mark the issue as needs_review and open a draft PR. Be honest in your status — nightcape's gate will second-guess you anyway.

Model: ${model}.
`;
}
```

- [ ] **Step 4: Run tests + lint**

```bash
bun test tests/prompt.test.ts
bun run lint
```
Expected: 7 prompt tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/prompt.ts tests/prompt.test.ts
git commit -m "feat: per-issue prompt builder with FinalJson contract"
```

---

## Task 10: Morning report writer

**Files:**
- Create: `src/report.ts`
- Create: `tests/report.test.ts`

- [ ] **Step 1: Write the failing tests**

`tests/report.test.ts`:
```ts
import { test, expect } from "bun:test";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initReport, appendIssueOutcome, finalizeReport } from "../src/report";

const tmp = () => mkdtempSync(join(tmpdir(), "nc-"));

test("initReport creates the file with header for the date", () => {
  const dir = tmp();
  const path = initReport(dir, "2026-04-29", new Date("2026-04-29T22:00:00Z"));
  expect(existsSync(path)).toBe(true);
  const content = readFileSync(path, "utf8");
  expect(content).toContain("# nightcape run 2026-04-29");
  expect(content).toContain("Started: ");
  rmSync(dir, { recursive: true });
});

test("appendIssueOutcome adds a section per issue with outcome glyph", () => {
  const dir = tmp();
  const path = initReport(dir, "2026-04-29", new Date("2026-04-29T22:00:00Z"));
  appendIssueOutcome(dir, "2026-04-29", {
    issue: 12, title: "Add search", outcome: "auto_merged",
    branch: "nightcape/issue-12", pr: 47, model: "sonnet",
    durationSec: 612, lintPassed: true, buildPassed: true, reviewSummary: "clean",
  });
  appendIssueOutcome(dir, "2026-04-29", {
    issue: 13, title: "Refactor auth", outcome: "needs_review",
    branch: "nightcape/issue-13", pr: 48, model: "sonnet",
    durationSec: 1080, lintPassed: true, buildPassed: true,
    reviewSummary: "1 Critical (token-leak)", reason: "code-review found 1 Critical finding",
    logPath: ".nightcape/logs/issue-13.log",
  });
  const c = readFileSync(path, "utf8");
  expect(c).toContain("## #12 — Add search");
  expect(c).toContain("auto-merged");
  expect(c).toContain("PR #47");
  expect(c).toContain("## #13 — Refactor auth");
  expect(c).toContain("needs review");
  expect(c).toContain("token-leak");
  rmSync(dir, { recursive: true });
});

test("finalizeReport writes a summary line at top once duration known", () => {
  const dir = tmp();
  initReport(dir, "2026-04-29", new Date("2026-04-29T22:00:00Z"));
  appendIssueOutcome(dir, "2026-04-29", {
    issue: 12, title: "x", outcome: "auto_merged", branch: "b", pr: 1,
    model: "sonnet", durationSec: 60, lintPassed: true, buildPassed: true, reviewSummary: "",
  });
  finalizeReport(dir, "2026-04-29", new Date("2026-04-30T04:18:00Z"));
  const c = readFileSync(join(dir, ".nightcape", "runs", "2026-04-29.md"), "utf8");
  expect(c).toContain("Ended:");
  expect(c).toContain("Auto-merged: 1");
  rmSync(dir, { recursive: true });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
bun test tests/report.test.ts
```
Expected: FAIL — module missing.

- [ ] **Step 3: Implement src/report.ts**

```ts
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import type { Outcome } from "./types";

function reportPath(repoRoot: string, date: string): string {
  return join(repoRoot, ".nightcape", "runs", `${date}.md`);
}

function ensureDir(p: string): void { if (!existsSync(p)) mkdirSync(p, { recursive: true }); }

export function initReport(repoRoot: string, date: string, started: Date): string {
  const path = reportPath(repoRoot, date);
  ensureDir(join(repoRoot, ".nightcape", "runs"));
  if (!existsSync(path)) {
    const header = `# nightcape run ${date}\n\nStarted: ${started.toISOString()}\n\n`;
    writeFileSync(path, header);
  }
  return path;
}

export type IssueOutcomeReport = {
  issue: number; title: string;
  outcome: Outcome;
  branch: string; pr?: number;
  model: "sonnet" | "opus";
  durationSec: number;
  lintPassed: boolean; buildPassed: boolean;
  reviewSummary: string;          // human one-liner; empty allowed
  reason?: string;                // failure reason if any
  logPath?: string;
};

const GLYPH: Record<Outcome, string> = {
  auto_merged: "✅ auto-merged",
  needs_review: "🟡 needs review",
  failed: "🔴 failed",
};

export function appendIssueOutcome(repoRoot: string, date: string, r: IssueOutcomeReport): void {
  const path = reportPath(repoRoot, date);
  const lint = r.lintPassed ? "✓" : "✗";
  const build = r.buildPassed ? "✓" : "✗";
  const prText = r.pr ? `PR #${r.pr}` : "(no PR)";
  const reason = r.reason ? `\n- reason: ${r.reason}` : "";
  const log = r.logPath ? `\n- log: ${r.logPath}` : "";
  const review = r.reviewSummary ? `\n- review: ${r.reviewSummary}` : "";
  const block = `\n## #${r.issue} — ${r.title}        ${GLYPH[r.outcome]}\n` +
    `- branch: ${r.branch} · ${prText} · ${r.model} · ${formatDuration(r.durationSec)}\n` +
    `- lint: ${lint} build: ${build}${review}${reason}${log}\n`;
  appendFileSync(path, block);
}

export function finalizeReport(repoRoot: string, date: string, ended: Date): void {
  const path = reportPath(repoRoot, date);
  if (!existsSync(path)) return;
  const body = readFileSync(path, "utf8");
  // Count outcomes already in body
  const counts = {
    auto_merged: (body.match(/✅ auto-merged/g) ?? []).length,
    needs_review: (body.match(/🟡 needs review/g) ?? []).length,
    failed: (body.match(/🔴 failed/g) ?? []).length,
  };
  const startedMatch = body.match(/^Started: (.+)$/m);
  const started = startedMatch ? new Date(startedMatch[1]!) : ended;
  const total = counts.auto_merged + counts.needs_review + counts.failed;
  const dur = formatDuration(Math.round((ended.getTime() - started.getTime()) / 1000));
  const summary = `Ended: ${ended.toISOString()} · Duration: ${dur}\nIssues processed: ${total} · Auto-merged: ${counts.auto_merged} · Needs review: ${counts.needs_review} · Failed: ${counts.failed}\n\n`;
  // Insert after the "Started: ..." line
  const next = body.replace(/^(Started: .+\n)\n?/m, `$1${summary}`);
  writeFileSync(path, next);
}

function formatDuration(sec: number): string {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60), s = sec % 60;
  if (m < 60) return `${m}m${s.toString().padStart(2, "0")}s`;
  const h = Math.floor(m / 60), mm = m % 60;
  return `${h}h${mm.toString().padStart(2, "0")}m`;
}
```

- [ ] **Step 4: Run tests + lint**

```bash
bun test tests/report.test.ts
bun run lint
```
Expected: 3 report tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/report.ts tests/report.test.ts
git commit -m "feat: morning report writer (init + append + finalize)"
```

---

## Task 11: gh + git runners (real implementations)

**Files:**
- Create: `src/runners/gh.ts`
- Create: `src/runners/git.ts`
- Create: `tests/runners.real.test.ts` (smoke-only — most coverage comes from fakes used elsewhere)

These are thin wrappers over `Bun.spawn`. Unit tests verify command construction by inspecting the spawned argv. Full integration tests are out of scope (run-on-demand, not CI-wired).

- [ ] **Step 1: Write the failing smoke tests**

`tests/runners.real.test.ts`:
```ts
import { test, expect } from "bun:test";
import { makeGhRunner } from "../src/runners/gh";
import { makeGitRunner } from "../src/runners/git";

type SpawnCall = { cmd: string[]; cwd: string };

function makeFakeSpawn(scripts: { match: (cmd: string[]) => boolean; stdout: string; stderr?: string; exitCode?: number }[]) {
  const calls: SpawnCall[] = [];
  return {
    calls,
    spawn: async (cmd: string[], opts: { cwd: string }) => {
      calls.push({ cmd, cwd: opts.cwd });
      const m = scripts.find(s => s.match(cmd));
      if (!m) throw new Error(`unscripted spawn: ${cmd.join(" ")}`);
      return { stdout: m.stdout, stderr: m.stderr ?? "", exitCode: m.exitCode ?? 0 };
    },
  };
}

test("gh.listIssuesByLabel calls gh issue list with --label and --json", async () => {
  const fake = makeFakeSpawn([
    { match: cmd => cmd[0] === "gh" && cmd[1] === "issue" && cmd[2] === "list",
      stdout: JSON.stringify([{ number: 12, title: "t", body: "b", labels: [{ name: "nightcape" }] }]) },
  ]);
  const gh = makeGhRunner({ cwd: "/repo", spawn: fake.spawn });
  const got = await gh.listIssuesByLabel("nightcape");
  expect(got).toEqual([{ number: 12, title: "t", body: "b", labels: ["nightcape"] }]);
  expect(fake.calls[0]!.cmd).toContain("--label");
  expect(fake.calls[0]!.cmd).toContain("nightcape");
  expect(fake.calls[0]!.cmd).toContain("--json");
});

test("gh.mergePrSquashAuto calls gh pr merge --squash --auto", async () => {
  const fake = makeFakeSpawn([
    { match: cmd => cmd[0] === "gh" && cmd[1] === "pr" && cmd[2] === "merge", stdout: "" },
  ]);
  const gh = makeGhRunner({ cwd: "/repo", spawn: fake.spawn });
  const r = await gh.mergePrSquashAuto(47);
  expect(r.ok).toBe(true);
  expect(fake.calls[0]!.cmd).toContain("--squash");
  expect(fake.calls[0]!.cmd).toContain("--auto");
  expect(fake.calls[0]!.cmd).toContain("47");
});

test("git.fetch calls git fetch <remote>", async () => {
  const fake = makeFakeSpawn([
    { match: cmd => cmd[0] === "git" && cmd[1] === "fetch", stdout: "" },
  ]);
  const git = makeGitRunner({ cwd: "/repo", spawn: fake.spawn });
  await git.fetch("origin");
  expect(fake.calls[0]!.cmd).toEqual(["git", "fetch", "origin"]);
});

test("git.revParse returns trimmed sha", async () => {
  const fake = makeFakeSpawn([
    { match: cmd => cmd[0] === "git" && cmd[1] === "rev-parse", stdout: "deadbeef\n" },
  ]);
  const git = makeGitRunner({ cwd: "/repo", spawn: fake.spawn });
  expect(await git.revParse("HEAD")).toBe("deadbeef");
});
```

- [ ] **Step 2: Run to verify failure**

```bash
bun test tests/runners.real.test.ts
```
Expected: FAIL — modules missing.

- [ ] **Step 3: Implement src/runners/gh.ts**

```ts
import type { GhRunner } from "./types";
import type { Issue } from "../types";

export type SpawnFn = (cmd: string[], opts: { cwd: string; stdin?: string }) =>
  Promise<{ stdout: string; stderr: string; exitCode: number }>;

export async function defaultSpawn(cmd: string[], opts: { cwd: string; stdin?: string }) {
  const proc = Bun.spawn(cmd, { cwd: opts.cwd, stdin: opts.stdin ? new TextEncoder().encode(opts.stdin) : undefined, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  const exitCode = await proc.exited;
  return { stdout, stderr, exitCode };
}

export function makeGhRunner(deps: { cwd: string; spawn?: SpawnFn }): GhRunner {
  const spawn = deps.spawn ?? defaultSpawn;
  const cwd = deps.cwd;

  return {
    async authStatus() {
      const r = await spawn(["gh", "auth", "status"], { cwd });
      return { ok: r.exitCode === 0, message: (r.stdout || r.stderr).trim() };
    },
    async listIssuesByLabel(label) {
      const r = await spawn(["gh", "issue", "list", "--label", label, "--state", "open",
        "--json", "number,title,body,labels", "--limit", "200"], { cwd });
      if (r.exitCode !== 0) throw new Error(`gh issue list failed: ${r.stderr}`);
      const raw = JSON.parse(r.stdout) as Array<{ number: number; title: string; body: string; labels: { name: string }[] }>;
      return raw.map(x => ({ number: x.number, title: x.title, body: x.body, labels: x.labels.map(l => l.name) }));
    },
    async getIssue(n) {
      const r = await spawn(["gh", "issue", "view", String(n), "--json", "number,title,body,labels"], { cwd });
      if (r.exitCode !== 0) throw new Error(`gh issue view ${n} failed: ${r.stderr}`);
      const raw = JSON.parse(r.stdout) as { number: number; title: string; body: string; labels: { name: string }[] };
      return { number: raw.number, title: raw.title, body: raw.body, labels: raw.labels.map(l => l.name) };
    },
    async commentIssue(n, body) {
      const r = await spawn(["gh", "issue", "comment", String(n), "--body", body], { cwd });
      if (r.exitCode !== 0) throw new Error(`gh issue comment ${n} failed: ${r.stderr}`);
    },
    async createPr(opts) {
      const cmd = ["gh", "pr", "create", "--title", opts.title, "--body", opts.body, "--head", opts.head, "--base", opts.base];
      if (opts.draft) cmd.push("--draft");
      const r = await spawn(cmd, { cwd });
      if (r.exitCode !== 0) throw new Error(`gh pr create failed: ${r.stderr}`);
      const url = r.stdout.trim().split("\n").pop() ?? "";
      const m = url.match(/\/pull\/(\d+)$/);
      const number = m ? parseInt(m[1]!, 10) : -1;
      return { number, url };
    },
    async mergePrSquashAuto(n) {
      const r = await spawn(["gh", "pr", "merge", String(n), "--squash", "--auto"], { cwd });
      return { ok: r.exitCode === 0, message: (r.stdout || r.stderr).trim() };
    },
  };
}
```

- [ ] **Step 4: Implement src/runners/git.ts**

```ts
import type { GitRunner } from "./types";
import { defaultSpawn, type SpawnFn } from "./gh";

export function makeGitRunner(deps: { cwd: string; spawn?: SpawnFn }): GitRunner {
  const spawn = deps.spawn ?? defaultSpawn;
  const cwd = deps.cwd;

  return {
    async isRepo() {
      const r = await spawn(["git", "rev-parse", "--is-inside-work-tree"], { cwd });
      return r.exitCode === 0 && r.stdout.trim() === "true";
    },
    async hasRemote() {
      const r = await spawn(["git", "remote"], { cwd });
      return r.exitCode === 0 && r.stdout.trim().length > 0;
    },
    async fetch(remote) {
      const r = await spawn(["git", "fetch", remote], { cwd });
      if (r.exitCode !== 0) throw new Error(`git fetch ${remote} failed: ${r.stderr}`);
    },
    async revParse(ref) {
      const r = await spawn(["git", "rev-parse", ref], { cwd });
      if (r.exitCode !== 0) throw new Error(`git rev-parse ${ref} failed: ${r.stderr}`);
      return r.stdout.trim();
    },
    async branchExists(name) {
      const r = await spawn(["git", "branch", "--list", name], { cwd });
      return r.exitCode === 0 && r.stdout.trim().length > 0;
    },
  };
}
```

- [ ] **Step 5: Run tests + lint**

```bash
bun test tests/runners.real.test.ts
bun run lint
```
Expected: 4 runner tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/runners/gh.ts src/runners/git.ts tests/runners.real.test.ts
git commit -m "feat: real gh and git runners over Bun.spawn"
```

---

## Task 12: claude runner with rate-limit detection

**Files:**
- Create: `src/runners/claude.ts`
- Create: `tests/runners.claude.test.ts`

The claude runner spawns `claude -p`, streams stdout/stderr to a log file, and inspects them for rate-limit signals. The user's superpowers plugin runs inside the spawned process, so nothing about superpowers is in our code.

- [ ] **Step 1: Write the failing tests**

`tests/runners.claude.test.ts`:
```ts
import { test, expect } from "bun:test";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeClaudeRunner, detectRateLimit } from "../src/runners/claude";

const tmp = () => mkdtempSync(join(tmpdir(), "nc-"));

test("detectRateLimit catches common phrases and parses ISO reset time when present", () => {
  expect(detectRateLimit("rate_limit_exceeded — usage cap reached. Reset at 2026-04-30T03:00:00Z."))
    .toEqual({ rateLimited: true, rateLimitUntil: "2026-04-30T03:00:00Z" });
  expect(detectRateLimit("you have exceeded your usage limit"))
    .toEqual({ rateLimited: true, rateLimitUntil: null });
  expect(detectRateLimit("normal output")).toEqual({ rateLimited: false, rateLimitUntil: null });
});

test("makeClaudeRunner.run forwards prompt via stdin and writes log file", async () => {
  const dir = tmp();
  const logPath = join(dir, "issue-12.log");
  const captured: { cmd: string[]; stdin?: string }[] = [];
  const runner = makeClaudeRunner({
    spawn: async (cmd, opts) => {
      captured.push({ cmd, stdin: opts.stdin });
      return { stdout: "doing things\n```json\n{\"status\":\"failed\",\"branch\":\"x\",\"lint_passed\":true,\"build_passed\":true,\"summary\":\"\"}\n```", stderr: "", exitCode: 0 };
    },
  });
  const r = await runner.run({
    prompt: "PROMPT", model: "sonnet", permissionMode: "dangerous", cwd: "/repo", logPath,
  });
  expect(captured[0]!.cmd[0]).toBe("claude");
  expect(captured[0]!.cmd).toContain("--model");
  expect(captured[0]!.cmd).toContain("sonnet");
  expect(captured[0]!.cmd).toContain("--dangerously-skip-permissions");
  expect(captured[0]!.cmd).toContain("--print");
  expect(captured[0]!.stdin).toBe("PROMPT");
  expect(existsSync(logPath)).toBe(true);
  expect(readFileSync(logPath, "utf8")).toContain("doing things");
  expect(r.rateLimited).toBe(false);
  rmSync(dir, { recursive: true });
});

test("makeClaudeRunner.run flags rateLimited when stderr signals rate_limit_exceeded", async () => {
  const dir = tmp();
  const runner = makeClaudeRunner({
    spawn: async () => ({ stdout: "", stderr: "rate_limit_exceeded; Reset at 2026-04-30T03:00:00Z.", exitCode: 1 }),
  });
  const r = await runner.run({
    prompt: "P", model: "sonnet", permissionMode: "dangerous", cwd: "/r", logPath: join(dir, "x.log"),
  });
  expect(r.rateLimited).toBe(true);
  expect(r.rateLimitUntil).toBe("2026-04-30T03:00:00Z");
  rmSync(dir, { recursive: true });
});

test("permissionMode acceptEdits passes --permission-mode acceptEdits and not --dangerously...", async () => {
  const dir = tmp();
  const captured: string[][] = [];
  const runner = makeClaudeRunner({
    spawn: async (cmd) => { captured.push(cmd); return { stdout: "", stderr: "", exitCode: 0 }; },
  });
  await runner.run({ prompt: "P", model: "sonnet", permissionMode: "acceptEdits", cwd: "/r", logPath: join(dir, "x.log") });
  expect(captured[0]).toContain("--permission-mode");
  expect(captured[0]).toContain("acceptEdits");
  expect(captured[0]).not.toContain("--dangerously-skip-permissions");
  rmSync(dir, { recursive: true });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
bun test tests/runners.claude.test.ts
```
Expected: FAIL — module missing.

- [ ] **Step 3: Implement src/runners/claude.ts**

```ts
import { writeFileSync } from "node:fs";
import type { ClaudeRunner, ClaudeRunResult } from "./types";
import { defaultSpawn, type SpawnFn } from "./gh";

const RATE_LIMIT_RE = /rate_limit_exceeded|usage (?:cap|limit) (?:reached|exceeded)|exceeded your usage limit/i;
const RESET_AT_RE = /reset at (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)/i;

export function detectRateLimit(text: string): { rateLimited: boolean; rateLimitUntil: string | null } {
  if (!RATE_LIMIT_RE.test(text)) return { rateLimited: false, rateLimitUntil: null };
  const m = text.match(RESET_AT_RE);
  return { rateLimited: true, rateLimitUntil: m ? m[1]! : null };
}

export function makeClaudeRunner(deps: { spawn?: SpawnFn } = {}): ClaudeRunner {
  const spawn = deps.spawn ?? defaultSpawn;
  return {
    async version() {
      const r = await spawn(["claude", "--version"], { cwd: process.cwd() });
      return r.stdout.trim();
    },
    async hasSuperpowers() {
      // Best-effort check — we look for the superpowers plugin directory under ~/.claude
      try {
        const home = process.env.HOME ?? "";
        if (!home) return false;
        const r = await spawn(["ls", `${home}/.claude/plugins/cache/claude-plugins-official`], { cwd: home });
        return r.exitCode === 0 && r.stdout.includes("superpowers");
      } catch { return false; }
    },
    async run(opts) {
      const start = Date.now();
      const cmd = ["claude", "--model", opts.model, "--print"];
      if (opts.permissionMode === "dangerous") cmd.push("--dangerously-skip-permissions");
      else cmd.push("--permission-mode", opts.permissionMode);

      const r = await spawn(cmd, { cwd: opts.cwd, stdin: opts.prompt });
      writeFileSync(opts.logPath, r.stdout + (r.stderr ? `\n--- stderr ---\n${r.stderr}` : ""));
      const rl = detectRateLimit(`${r.stdout}\n${r.stderr}`);
      const result: ClaudeRunResult = {
        stdout: r.stdout,
        stderr: r.stderr,
        exitCode: r.exitCode,
        durationSec: Math.round((Date.now() - start) / 1000),
        rateLimited: rl.rateLimited,
        rateLimitUntil: rl.rateLimitUntil,
      };
      return result;
    },
  };
}
```

- [ ] **Step 4: Run tests + lint**

```bash
bun test tests/runners.claude.test.ts
bun run lint
```
Expected: 4 claude-runner tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/runners/claude.ts tests/runners.claude.test.ts
git commit -m "feat: claude runner with rate-limit detection"
```

---

## Task 13: Orchestrator (per-issue lifecycle)

**Files:**
- Create: `src/orchestrator.ts`
- Create: `tests/orchestrator.test.ts`

This is the largest unit. The orchestrator processes one issue per call to `runIssue`. The queue loop is built on top in Task 17.

- [ ] **Step 1: Write the failing tests**

`tests/orchestrator.test.ts`:
```ts
import { test, expect } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runIssue } from "../src/orchestrator";
import { DEFAULT_CONFIG } from "../src/config";
import { initState } from "../src/state";
import { FakeGh, FakeGit, FakeClaude } from "./fakes/runners";
import {
  ISSUE_12, ISSUE_13_OPUS,
  FINAL_JSON_READY, FINAL_JSON_REVIEW_BLOCKED, FINAL_JSON_LINT_FAILED,
  claudeOutputWith, CLAUDE_RATE_LIMIT_STDERR,
} from "./fakes/fixtures";

const tmp = () => mkdtempSync(join(tmpdir(), "nc-"));
function setupFakes(scriptedClaudeStdout: string, claudeOpts?: Partial<{ exitCode: number; stderr: string; rateLimited: boolean; rateLimitUntil: string | null }>) {
  const gh = new FakeGh();
  gh.issues = [ISSUE_12, ISSUE_13_OPUS];
  const git = new FakeGit();
  const claude = new FakeClaude();
  claude.responses.push({
    stdout: scriptedClaudeStdout,
    stderr: claudeOpts?.stderr ?? "",
    exitCode: claudeOpts?.exitCode ?? 0,
    rateLimited: claudeOpts?.rateLimited ?? false,
    rateLimitUntil: claudeOpts?.rateLimitUntil ?? null,
  });
  return { gh, git, claude };
}

test("happy path: ready_to_merge → creates PR → mergePrSquashAuto → state.completed=auto_merged", async () => {
  const dir = tmp();
  let state = initState(dir, [12]);
  const { gh, git, claude } = setupFakes(claudeOutputWith(FINAL_JSON_READY));
  gh.prMergeAcceptedFor.add(100);
  const r = await runIssue({
    issueNumber: 12, repoRoot: dir, config: DEFAULT_CONFIG, state,
    runners: { gh, git, claude }, now: () => new Date("2026-04-29T22:00:00Z"),
  });
  expect(r.state.completed.at(-1)).toMatchObject({ issue: 12, outcome: "auto_merged", pr: 100 });
  // Verify createPr was called with non-draft, mergePrSquashAuto called with the new PR number
  expect(gh.calls.find(c => c.method === "createPr")).toBeDefined();
  expect((gh.calls.find(c => c.method === "createPr")!.args[0] as any).draft).toBe(false);
  expect(gh.calls.find(c => c.method === "mergePrSquashAuto")).toBeDefined();
  rmSync(dir, { recursive: true });
});

test("review-blocked: opens DRAFT PR, comments, marks needs_review (no merge attempted)", async () => {
  const dir = tmp();
  let state = initState(dir, [13]);
  const { gh, git, claude } = setupFakes(claudeOutputWith(FINAL_JSON_REVIEW_BLOCKED));
  const r = await runIssue({
    issueNumber: 13, repoRoot: dir, config: DEFAULT_CONFIG, state,
    runners: { gh, git, claude }, now: () => new Date(),
  });
  expect(r.state.completed.at(-1)?.outcome).toBe("needs_review");
  expect((gh.calls.find(c => c.method === "createPr")!.args[0] as any).draft).toBe(true);
  expect(gh.calls.find(c => c.method === "mergePrSquashAuto")).toBeUndefined();
  expect(gh.calls.find(c => c.method === "commentIssue")).toBeDefined();
  rmSync(dir, { recursive: true });
});

test("lint-failed: opens DRAFT PR, no merge", async () => {
  const dir = tmp();
  let state = initState(dir, [14]);
  const { gh, git, claude } = setupFakes(claudeOutputWith(FINAL_JSON_LINT_FAILED));
  // listIssuesByLabel/getIssue need an issue 14
  gh.issues.push({ number: 14, title: "lint test", body: "Plan: x", labels: ["nightcape"] });
  const r = await runIssue({
    issueNumber: 14, repoRoot: dir, config: DEFAULT_CONFIG, state,
    runners: { gh, git, claude }, now: () => new Date(),
  });
  expect(r.state.completed.at(-1)?.outcome).toBe("needs_review");
  expect(r.state.completed.at(-1)?.reason).toContain("lint");
  rmSync(dir, { recursive: true });
});

test("rate-limit detected: state.rate_limit_until set; issue NOT marked completed; orchestrator returns shouldSleep", async () => {
  const dir = tmp();
  let state = initState(dir, [12]);
  const { gh, git, claude } = setupFakes("", {
    exitCode: 1, stderr: CLAUDE_RATE_LIMIT_STDERR, rateLimited: true, rateLimitUntil: "2026-04-30T03:00:00Z",
  });
  const r = await runIssue({
    issueNumber: 12, repoRoot: dir, config: DEFAULT_CONFIG, state,
    runners: { gh, git, claude }, now: () => new Date(),
  });
  expect(r.shouldSleep).toBe(true);
  expect(r.sleepUntil).toBe("2026-04-30T03:00:00Z");
  expect(r.state.rate_limit_until).toBe("2026-04-30T03:00:00Z");
  expect(r.state.completed).toHaveLength(0); // requeue, not complete
  expect(r.state.in_progress).toBe(12);
  rmSync(dir, { recursive: true });
});

test("nightcape:opus label switches model passed to claude", async () => {
  const dir = tmp();
  let state = initState(dir, [13]);
  const { gh, git, claude } = setupFakes(claudeOutputWith({ ...FINAL_JSON_READY, branch: "nightcape/issue-13" }));
  gh.prMergeAcceptedFor.add(100);
  await runIssue({
    issueNumber: 13, repoRoot: dir, config: DEFAULT_CONFIG, state,
    runners: { gh, git, claude }, now: () => new Date(),
  });
  const callArgs = (claude.calls.find(c => c.method === "run")!.args[0] as any);
  expect(callArgs.model).toBe("opus");
  rmSync(dir, { recursive: true });
});

test("nightcape:safe label switches permission mode to acceptEdits", async () => {
  const dir = tmp();
  let state = initState(dir, [15]);
  const { gh, git, claude } = setupFakes(claudeOutputWith({ ...FINAL_JSON_READY, branch: "nightcape/issue-15" }));
  gh.issues.push({ number: 15, title: "safe", body: "Plan: x", labels: ["nightcape", "nightcape:safe"] });
  gh.prMergeAcceptedFor.add(100);
  await runIssue({
    issueNumber: 15, repoRoot: dir, config: DEFAULT_CONFIG, state,
    runners: { gh, git, claude }, now: () => new Date(),
  });
  const callArgs = (claude.calls.find(c => c.method === "run")!.args[0] as any);
  expect(callArgs.permissionMode).toBe("acceptEdits");
  rmSync(dir, { recursive: true });
});

test("malformed final-JSON treated as needs_review with appropriate reason", async () => {
  const dir = tmp();
  let state = initState(dir, [12]);
  const { gh, git, claude } = setupFakes("doing work, no json block here");
  const r = await runIssue({
    issueNumber: 12, repoRoot: dir, config: DEFAULT_CONFIG, state,
    runners: { gh, git, claude }, now: () => new Date(),
  });
  expect(r.state.completed.at(-1)?.outcome).toBe("needs_review");
  expect(r.state.completed.at(-1)?.reason).toContain("final-JSON");
  rmSync(dir, { recursive: true });
});

test("auto-merge call rejection (branch protection) → falls back to needs_review", async () => {
  const dir = tmp();
  let state = initState(dir, [12]);
  const { gh, git, claude } = setupFakes(claudeOutputWith(FINAL_JSON_READY));
  // gh.prMergeAcceptedFor empty → mergePrSquashAuto returns ok:false
  const r = await runIssue({
    issueNumber: 12, repoRoot: dir, config: DEFAULT_CONFIG, state,
    runners: { gh, git, claude }, now: () => new Date(),
  });
  expect(r.state.completed.at(-1)?.outcome).toBe("needs_review");
  expect(r.state.completed.at(-1)?.reason).toContain("merge");
  rmSync(dir, { recursive: true });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
bun test tests/orchestrator.test.ts
```
Expected: FAIL — module missing.

- [ ] **Step 3: Implement src/orchestrator.ts**

```ts
import { join } from "node:path";
import type { Config, State } from "./types";
import type { GhRunner, GitRunner, ClaudeRunner } from "./runners/types";
import { markInProgress, recordCompletion, setRateLimit, saveState } from "./state";
import { buildPrompt } from "./prompt";
import { parseFinalJson } from "./parse";
import { decideOutcome } from "./gates";
import { appendIssueOutcome } from "./report";

export type RunIssueArgs = {
  issueNumber: number;
  repoRoot: string;
  config: Config;
  state: State;
  runners: { gh: GhRunner; git: GitRunner; claude: ClaudeRunner };
  now: () => Date;
};

export type RunIssueResult = {
  state: State;
  shouldSleep: boolean;
  sleepUntil?: string | null;
};

export async function runIssue(args: RunIssueArgs): Promise<RunIssueResult> {
  const { issueNumber, repoRoot, config, state: state0, runners, now } = args;
  const startedAt = now();
  let state = markInProgress(state0, issueNumber);
  saveState(repoRoot, state);

  const issue = await runners.gh.getIssue(issueNumber);
  const model: "sonnet" | "opus" = issue.labels.includes("nightcape:opus") ? "opus" : config.default_model;
  const permissionMode = issue.labels.includes("nightcape:safe") ? "acceptEdits" : config.permission_mode;

  const dateLabel = state.run_id.slice(0, 10); // YYYY-MM-DD prefix
  const logPath = join(repoRoot, ".nightcape", "logs", `issue-${issueNumber}-${state.run_id}.log`);

  const prompt = buildPrompt({ issue, model, config });
  await runners.git.fetch("origin");

  const cr = await runners.claude.run({
    prompt, model, permissionMode, cwd: repoRoot, logPath,
  });

  if (cr.rateLimited) {
    state = setRateLimit(state, cr.rateLimitUntil);
    saveState(repoRoot, state);
    return { state, shouldSleep: true, sleepUntil: cr.rateLimitUntil };
  }

  const fj = parseFinalJson(cr.stdout);
  const decision = decideOutcome(fj, config);

  // PR creation
  const branch = fj?.branch ?? `nightcape/issue-${issueNumber}`;
  const draft = decision.outcome !== "auto_merged";
  let prNumber: number | undefined;
  let mergeMessage: string | undefined;
  try {
    const pr = await runners.gh.createPr({
      title: draft ? `WIP: nightcape #${issueNumber} ${issue.title}` : `nightcape: ${issue.title} (#${issueNumber})`,
      body: buildPrBody(issueNumber, fj, decision.reason),
      head: branch, base: "main", draft,
    });
    prNumber = pr.number;
  } catch (e) {
    // No commits to push, or branch never created. Treat as failed.
    const dur = Math.round((now().getTime() - startedAt.getTime()) / 1000);
    state = recordCompletion(state, {
      issue: issueNumber, outcome: "failed", branch,
      duration_sec: dur, model, reason: `pr-create failed: ${(e as Error).message}`,
    });
    saveState(repoRoot, state);
    appendIssueOutcome(repoRoot, dateLabel, {
      issue: issueNumber, title: issue.title, outcome: "failed",
      branch, model, durationSec: dur,
      lintPassed: fj?.lint_passed ?? false, buildPassed: fj?.build_passed ?? false,
      reviewSummary: "", reason: `pr-create failed`, logPath: logPath,
    });
    return { state, shouldSleep: false };
  }

  let outcome = decision.outcome;
  let reason = decision.reason;

  if (outcome === "auto_merged") {
    const mr = await runners.gh.mergePrSquashAuto(prNumber);
    if (!mr.ok) {
      outcome = "needs_review";
      reason = `merge call rejected: ${mr.message}`;
      // Reopen as draft? PR already created non-draft. Just mark issue as needs_review and comment.
    }
    mergeMessage = mr.message;
  }

  if (outcome !== "auto_merged") {
    await runners.gh.commentIssue(issueNumber, buildIssueComment(prNumber, fj, reason, logPath));
  }

  const dur = Math.round((now().getTime() - startedAt.getTime()) / 1000);
  state = recordCompletion(state, {
    issue: issueNumber, outcome, branch, pr: prNumber,
    duration_sec: dur, model, reason,
  });
  saveState(repoRoot, state);

  appendIssueOutcome(repoRoot, dateLabel, {
    issue: issueNumber, title: issue.title, outcome,
    branch, pr: prNumber, model, durationSec: dur,
    lintPassed: fj?.lint_passed ?? false, buildPassed: fj?.build_passed ?? false,
    reviewSummary: summarizeFindings(fj?.review_findings ?? []), reason,
    logPath: outcome === "auto_merged" ? undefined : logPath,
  });
  return { state, shouldSleep: false };
}

function summarizeFindings(findings: { severity: string; summary: string }[]): string {
  if (findings.length === 0) return "clean";
  const counts: Record<string, number> = {};
  for (const f of findings) counts[f.severity] = (counts[f.severity] ?? 0) + 1;
  return Object.entries(counts).map(([s, n]) => `${n} ${s}`).join(", ");
}

function buildPrBody(issueNumber: number, fj: ReturnType<typeof parseFinalJson>, reason?: string): string {
  const summary = fj?.summary ?? "(claude did not emit a summary)";
  const findings = fj?.review_findings ?? [];
  const findingLines = findings.length === 0 ? "_no findings_" :
    findings.map(f => `- **${f.severity}**: ${f.summary}${f.file ? ` (\`${f.file}${f.line ? ":" + f.line : ""}\`)` : ""}`).join("\n");
  const reasonLine = reason ? `\n\n_nightcape note:_ ${reason}` : "";
  return `Closes #${issueNumber}\n\n## Summary\n${summary}\n\n## Code-review findings\n${findingLines}${reasonLine}\n\n---\n*Opened by nightcape.*`;
}

function buildIssueComment(prNumber: number | undefined, fj: ReturnType<typeof parseFinalJson>, reason?: string, logPath?: string): string {
  const prLink = prNumber ? `PR #${prNumber}` : "(no PR)";
  const r = reason ?? "see attached log";
  const log = logPath ? `\nLog: \`${logPath}\`` : "";
  return `nightcape: ${prLink} — needs review.\nReason: ${r}${log}\n\n_Opened by nightcape (overnight run)._`;
}
```

- [ ] **Step 4: Run tests + lint**

```bash
bun test tests/orchestrator.test.ts
bun run lint
```
Expected: 8 orchestrator tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/orchestrator.ts tests/orchestrator.test.ts
git commit -m "feat: per-issue orchestrator with full lifecycle and decision wiring"
```

---

## Task 14: doctor command + preflight

**Files:**
- Create: `src/commands/doctor.ts`
- Create: `tests/commands.doctor.test.ts`

- [ ] **Step 1: Write the failing tests**

`tests/commands.doctor.test.ts`:
```ts
import { test, expect } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runDoctor } from "../src/commands/doctor";
import { FakeGh, FakeGit, FakeClaude } from "./fakes/runners";
import { scaffoldConfig } from "../src/config";

const tmp = () => mkdtempSync(join(tmpdir(), "nc-"));

test("doctor passes when all deps healthy and config valid", async () => {
  const dir = tmp();
  scaffoldConfig(dir);
  const r = await runDoctor({
    repoRoot: dir,
    runners: { gh: new FakeGh(), git: makeHealthyGit(), claude: makeHealthyClaude() },
    bunVersion: "1.1.0", which: async () => "/usr/local/bin/cmd",
  });
  expect(r.exitCode).toBe(0);
  expect(r.stdout).toContain("✓");
  rmSync(dir, { recursive: true });
});

test("doctor fails when gh not authenticated", async () => {
  const dir = tmp();
  scaffoldConfig(dir);
  const gh = new FakeGh(); gh.authOk = false;
  const r = await runDoctor({
    repoRoot: dir, runners: { gh, git: makeHealthyGit(), claude: makeHealthyClaude() },
    bunVersion: "1.1.0", which: async () => "/usr/local/bin/cmd",
  });
  expect(r.exitCode).toBe(1);
  expect(r.stdout).toContain("gh auth");
  expect(r.stdout).toContain("✗");
  rmSync(dir, { recursive: true });
});

test("doctor fails when config missing", async () => {
  const dir = tmp();
  const r = await runDoctor({
    repoRoot: dir, runners: { gh: new FakeGh(), git: makeHealthyGit(), claude: makeHealthyClaude() },
    bunVersion: "1.1.0", which: async () => "/usr/local/bin/cmd",
  });
  expect(r.exitCode).toBe(1);
  expect(r.stdout).toContain("config");
  rmSync(dir, { recursive: true });
});

test("doctor warns (non-fatal) when permission_mode != dangerous", async () => {
  const dir = tmp();
  scaffoldConfig(dir);
  // Hand-edit to acceptEdits
  await Bun.write(join(dir, ".nightcape", "config.json"), JSON.stringify({
    label: "nightcape", default_model: "sonnet", permission_mode: "acceptEdits",
    lint: "bun run lint", build: "bun run build", worktrees_dir: "~/.nightcape/worktrees",
    max_issues_per_run: 20, blocking_severities: ["Critical","Important"],
  }, null, 2));
  const r = await runDoctor({
    repoRoot: dir, runners: { gh: new FakeGh(), git: makeHealthyGit(), claude: makeHealthyClaude() },
    bunVersion: "1.1.0", which: async () => "/usr/local/bin/cmd",
  });
  expect(r.stdout).toContain("warn");
  expect(r.stdout).toContain("acceptEdits");
  rmSync(dir, { recursive: true });
});

function makeHealthyGit() { const g = new FakeGit(); g.repoOk = true; g.remoteOk = true; return g; }
function makeHealthyClaude() { const c = new FakeClaude(); c.superpowersInstalled = true; return c; }
```

- [ ] **Step 2: Run to verify failure**

```bash
bun test tests/commands.doctor.test.ts
```
Expected: FAIL — module missing.

- [ ] **Step 3: Implement src/commands/doctor.ts**

```ts
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { GhRunner, GitRunner, ClaudeRunner } from "../runners/types";
import { loadConfig } from "../config";
import { isLockHeld } from "../lock";

type CheckResult = { name: string; ok: boolean; warn?: boolean; message: string };

export type RunDoctorArgs = {
  repoRoot: string;
  runners: { gh: GhRunner; git: GitRunner; claude: ClaudeRunner };
  bunVersion: string;
  which: (cmd: string) => Promise<string | null>;
};

export async function runDoctor(args: RunDoctorArgs): Promise<{ stdout: string; exitCode: number }> {
  const checks: CheckResult[] = [];

  checks.push({ name: "bun", ok: !!args.bunVersion, message: `Bun ${args.bunVersion}` });

  for (const cmd of ["git", "gh", "claude"]) {
    const path = await args.which(cmd);
    checks.push({ name: cmd, ok: !!path, message: path ?? `not found on PATH` });
  }

  const repoOk = await args.runners.git.isRepo();
  checks.push({ name: "git repo", ok: repoOk, message: repoOk ? "current dir is a git repo" : "not a git repo" });
  const remoteOk = await args.runners.git.hasRemote();
  checks.push({ name: "git remote", ok: remoteOk, message: remoteOk ? "remote configured" : "no git remote" });

  const auth = await args.runners.gh.authStatus();
  checks.push({ name: "gh auth", ok: auth.ok, message: auth.message });

  const sp = await args.runners.claude.hasSuperpowers();
  checks.push({ name: "superpowers plugin", ok: sp, message: sp ? "installed" : "not detected (install via Claude Code marketplace)" });

  const cfg = loadConfig(args.repoRoot);
  if (!cfg.ok) {
    checks.push({ name: ".nightcape/config.json", ok: false, message: `config ${cfg.reason}${cfg.errors ? ": " + cfg.errors.join("; ") : ""}` });
  } else {
    checks.push({ name: ".nightcape/config.json", ok: true, message: "valid" });
    if (cfg.config.permission_mode !== "dangerous") {
      checks.push({ name: "permission_mode", ok: true, warn: true, message: `permission_mode = ${cfg.config.permission_mode} — headless runs may stall on permission prompts` });
    }
    for (const [field, cmd] of [["lint", cfg.config.lint], ["build", cfg.config.build]] as const) {
      if (!cmd) continue;
      const head = cmd.split(/\s+/)[0]!;
      const p = await args.which(head);
      checks.push({ name: `${field} command`, ok: !!p, message: p ? `${cmd} → ${p}` : `${field} command head '${head}' not on PATH` });
    }
  }

  if (isLockHeld(args.repoRoot)) {
    checks.push({ name: "run.lock", ok: false, message: "another nightcape is running (or a stale lock; run 'nightcape stop' or remove .nightcape/run.lock if certain)" });
  }

  const lines: string[] = [];
  let allOk = true;
  for (const c of checks) {
    const glyph = c.ok ? (c.warn ? "⚠" : "✓") : "✗";
    if (!c.ok) allOk = false;
    lines.push(`${glyph} ${c.name}: ${c.message}${c.warn ? " (warn)" : ""}`);
  }
  return { stdout: lines.join("\n") + "\n", exitCode: allOk ? 0 : 1 };
}
```

- [ ] **Step 4: Run tests + lint**

```bash
bun test tests/commands.doctor.test.ts
bun run lint
```
Expected: 4 doctor tests PASS.

- [ ] **Step 5: Wire `doctor` into the CLI dispatcher**

Edit `src/cli.ts`:
```ts
import { helpCommand } from "./commands/help";
import { runDoctor } from "./commands/doctor";
import { makeGhRunner } from "./runners/gh";
import { makeGitRunner } from "./runners/git";
import { makeClaudeRunner } from "./runners/claude";

export type CliResult = { stdout: string; stderr: string; exitCode: number };

export async function runCli(argv: string[]): Promise<CliResult> {
  const command = argv[0] ?? "help";

  if (command === "help" || command === "--help" || command === "-h") {
    const { stdout, exitCode } = await helpCommand();
    return { stdout, stderr: "", exitCode };
  }

  if (command === "doctor") {
    const cwd = process.cwd();
    const r = await runDoctor({
      repoRoot: cwd,
      runners: {
        gh: makeGhRunner({ cwd }),
        git: makeGitRunner({ cwd }),
        claude: makeClaudeRunner(),
      },
      bunVersion: Bun.version,
      which: async (cmd) => {
        const p = Bun.spawn(["which", cmd], { stdout: "pipe", stderr: "pipe" });
        await p.exited;
        const out = (await new Response(p.stdout).text()).trim();
        return out || null;
      },
    });
    return { stdout: r.stdout, stderr: "", exitCode: r.exitCode };
  }

  return {
    stdout: "",
    stderr: `nightcape: unknown command '${command}'\nRun 'nightcape help' for usage.\n`,
    exitCode: 1,
  };
}
```

- [ ] **Step 6: Smoke check**

```bash
bun run bin/nightcape.ts doctor
```
Expected: prints check results; exits 0 if your env is healthy, else 1 with hints.

- [ ] **Step 7: Commit**

```bash
git add src/commands/doctor.ts src/cli.ts tests/commands.doctor.test.ts
git commit -m "feat: doctor command with full preflight and CLI wiring"
```

---

## Task 15: init command

**Files:**
- Create: `src/commands/init.ts`
- Create: `tests/commands.init.test.ts`

- [ ] **Step 1: Write the failing tests**

`tests/commands.init.test.ts`:
```ts
import { test, expect } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInit } from "../src/commands/init";

const tmp = () => mkdtempSync(join(tmpdir(), "nc-"));

test("init scaffolds .nightcape/config.json with defaults", async () => {
  const dir = tmp();
  const r = await runInit({ repoRoot: dir });
  expect(r.exitCode).toBe(0);
  expect(existsSync(join(dir, ".nightcape", "config.json"))).toBe(true);
  rmSync(dir, { recursive: true });
});

test("init adds .nightcape/ to .gitignore (creating .gitignore if absent)", async () => {
  const dir = tmp();
  await runInit({ repoRoot: dir });
  const gi = readFileSync(join(dir, ".gitignore"), "utf8");
  expect(gi).toContain(".nightcape/");
  rmSync(dir, { recursive: true });
});

test("init does not duplicate .nightcape/ entry on re-run", async () => {
  const dir = tmp();
  writeFileSync(join(dir, ".gitignore"), "node_modules/\n.nightcape/\n");
  await runInit({ repoRoot: dir });
  const gi = readFileSync(join(dir, ".gitignore"), "utf8");
  expect(gi.split("\n").filter(l => l.trim() === ".nightcape/")).toHaveLength(1);
  rmSync(dir, { recursive: true });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
bun test tests/commands.init.test.ts
```
Expected: FAIL — module missing.

- [ ] **Step 3: Implement src/commands/init.ts**

```ts
import { existsSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { scaffoldConfig } from "../config";

export async function runInit(args: { repoRoot: string }): Promise<{ stdout: string; exitCode: number }> {
  scaffoldConfig(args.repoRoot);
  ensureGitignoreEntry(args.repoRoot);
  return {
    stdout: `nightcape: scaffolded ${join(".nightcape", "config.json")} and updated .gitignore.\n` +
            `Run 'nightcape doctor' to verify your environment.\n`,
    exitCode: 0,
  };
}

function ensureGitignoreEntry(repoRoot: string) {
  const giPath = join(repoRoot, ".gitignore");
  if (!existsSync(giPath)) {
    writeFileSync(giPath, ".nightcape/\n");
    return;
  }
  const cur = readFileSync(giPath, "utf8");
  if (cur.split("\n").some(l => l.trim() === ".nightcape/")) return;
  appendFileSync(giPath, (cur.endsWith("\n") ? "" : "\n") + ".nightcape/\n");
}
```

- [ ] **Step 4: Wire into CLI**

In `src/cli.ts`, add an `init` branch that calls `runInit({ repoRoot: process.cwd() })`. Pattern matches the `doctor` branch.

- [ ] **Step 5: Run tests + lint**

```bash
bun test tests/commands.init.test.ts
bun run lint
```
Expected: 3 init tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/commands/init.ts src/cli.ts tests/commands.init.test.ts
git commit -m "feat: init command scaffolds config and updates .gitignore"
```

---

## Task 16: status, reset, report, stop, help-wired commands

**Files:**
- Create: `src/commands/status.ts`
- Create: `src/commands/reset.ts`
- Create: `src/commands/report.ts`
- Create: `src/commands/stop.ts`
- Create: `tests/commands.misc.test.ts`

- [ ] **Step 1: Write the failing tests**

`tests/commands.misc.test.ts`:
```ts
import { test, expect } from "bun:test";
import { mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runStatus } from "../src/commands/status";
import { runReset } from "../src/commands/reset";
import { runReport } from "../src/commands/report";
import { runStop } from "../src/commands/stop";
import { initState, recordCompletion } from "../src/state";
import { acquireLock } from "../src/lock";

const tmp = () => mkdtempSync(join(tmpdir(), "nc-"));

test("status: with no state file says 'no run'", async () => {
  const dir = tmp();
  const r = await runStatus({ repoRoot: dir, isAlive: () => true });
  expect(r.exitCode).toBe(0);
  expect(r.stdout).toContain("no nightcape run");
  rmSync(dir, { recursive: true });
});

test("status: prints current run summary when state present and lock alive", async () => {
  const dir = tmp();
  let s = initState(dir, [12, 13]);
  s = recordCompletion(s, { issue: 12, outcome: "auto_merged", branch: "b", pr: 1, duration_sec: 60, model: "sonnet" });
  // mark in_progress=13
  s = { ...s, in_progress: 13 };
  // save (cheap: re-init not needed; reuse saveState)
  await Bun.write(join(dir, ".nightcape", "state.json"), JSON.stringify(s, null, 2));
  acquireLock(dir, () => true);
  const r = await runStatus({ repoRoot: dir, isAlive: () => true });
  expect(r.stdout).toContain("running");
  expect(r.stdout).toContain("in progress: #13");
  expect(r.stdout).toContain("queue:");
  rmSync(dir, { recursive: true });
});

test("reset: clears state.json (no archive flag)", async () => {
  const dir = tmp();
  initState(dir, [1]);
  const r = await runReset({ repoRoot: dir, archive: false, isAlive: () => true });
  expect(r.exitCode).toBe(0);
  expect(existsSync(join(dir, ".nightcape", "state.json"))).toBe(false);
  rmSync(dir, { recursive: true });
});

test("reset: refuses if nightcape is currently running", async () => {
  const dir = tmp();
  initState(dir, [1]);
  acquireLock(dir, () => true);
  const r = await runReset({ repoRoot: dir, archive: false, isAlive: () => true });
  expect(r.exitCode).toBe(1);
  expect(r.stderr).toContain("running");
  rmSync(dir, { recursive: true });
});

test("reset --archive: moves state to runs/<date>/", async () => {
  const dir = tmp();
  initState(dir, [1]);
  const r = await runReset({ repoRoot: dir, archive: true, isAlive: () => true, today: "2026-04-29" });
  expect(r.exitCode).toBe(0);
  expect(existsSync(join(dir, ".nightcape", "runs", "2026-04-29", "state.json"))).toBe(true);
  rmSync(dir, { recursive: true });
});

test("report: prints latest report when no date given", async () => {
  const dir = tmp();
  const dirRuns = join(dir, ".nightcape", "runs");
  mkdirSync(dirRuns, { recursive: true });
  writeFileSync(join(dirRuns, "2026-04-29.md"), "# nightcape run 2026-04-29\n");
  writeFileSync(join(dirRuns, "2026-04-30.md"), "# nightcape run 2026-04-30\n");
  const r = await runReport({ repoRoot: dir });
  expect(r.stdout).toContain("2026-04-30");
  rmSync(dir, { recursive: true });
});

test("report: prints requested date", async () => {
  const dir = tmp();
  const dirRuns = join(dir, ".nightcape", "runs");
  mkdirSync(dirRuns, { recursive: true });
  writeFileSync(join(dirRuns, "2026-04-29.md"), "# nightcape run 2026-04-29\n");
  const r = await runReport({ repoRoot: dir, date: "2026-04-29" });
  expect(r.stdout).toContain("2026-04-29");
  rmSync(dir, { recursive: true });
});

test("stop: sends SIGTERM to PID in lockfile (mocked)", async () => {
  const dir = tmp();
  acquireLock(dir, () => true);
  const sig: { pid: number; signal: string }[] = [];
  const r = await runStop({ repoRoot: dir, killFn: (pid, signal) => { sig.push({ pid, signal: String(signal) }); }, isAlive: () => true });
  expect(r.exitCode).toBe(0);
  expect(sig).toHaveLength(1);
  expect(sig[0]!.signal).toBe("SIGTERM");
  rmSync(dir, { recursive: true });
});

test("stop: when no lockfile exits 0 with hint", async () => {
  const dir = tmp();
  const r = await runStop({ repoRoot: dir, killFn: () => {}, isAlive: () => true });
  expect(r.exitCode).toBe(0);
  expect(r.stdout).toContain("not running");
  rmSync(dir, { recursive: true });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
bun test tests/commands.misc.test.ts
```
Expected: FAIL — modules missing.

- [ ] **Step 3: Implement src/commands/status.ts**

```ts
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isLockHeld, type IsAliveFn } from "../lock";
import type { State } from "../types";

export async function runStatus(args: { repoRoot: string; isAlive?: IsAliveFn }): Promise<{ stdout: string; exitCode: number }> {
  const path = join(args.repoRoot, ".nightcape", "state.json");
  if (!existsSync(path)) return { stdout: "no nightcape run on disk\n", exitCode: 0 };
  const s = JSON.parse(readFileSync(path, "utf8")) as State;
  const running = isLockHeld(args.repoRoot, args.isAlive);
  const remaining = s.queue_snapshot.filter(n => !s.completed.some(c => c.issue === n) && n !== s.in_progress);
  const counts = countOutcomes(s);
  const lines = [
    running ? "nightcape is running" : "nightcape is not running",
    `run id: ${s.run_id} (started ${s.started_at})`,
    s.in_progress !== null ? `in progress: #${s.in_progress}` : "in progress: (none)",
    `queue: ${remaining.length} remaining (${remaining.join(", ") || "—"})`,
    `completed: ${s.completed.length} (auto-merged: ${counts.auto_merged}, needs review: ${counts.needs_review}, failed: ${counts.failed})`,
    s.rate_limit_until ? `rate-limited until: ${s.rate_limit_until}` : `not rate-limited`,
  ];
  return { stdout: lines.join("\n") + "\n", exitCode: 0 };
}

function countOutcomes(s: State) {
  const c = { auto_merged: 0, needs_review: 0, failed: 0 } as Record<string, number>;
  for (const e of s.completed) c[e.outcome] = (c[e.outcome] ?? 0) + 1;
  return c as { auto_merged: number; needs_review: number; failed: number };
}
```

- [ ] **Step 4: Implement src/commands/reset.ts**

```ts
import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { isLockHeld, type IsAliveFn } from "../lock";
import { archiveState } from "../state";

export async function runReset(args: { repoRoot: string; archive: boolean; today?: string; isAlive?: IsAliveFn }): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  if (isLockHeld(args.repoRoot, args.isAlive)) {
    return { stdout: "", stderr: "nightcape: refusing to reset — a nightcape run is currently running. Stop it first ('nightcape stop').\n", exitCode: 1 };
  }
  const path = join(args.repoRoot, ".nightcape", "state.json");
  if (!existsSync(path)) return { stdout: "nothing to reset\n", stderr: "", exitCode: 0 };
  if (args.archive) {
    const date = args.today ?? new Date().toISOString().slice(0, 10);
    archiveState(args.repoRoot, date);
    return { stdout: `archived state to .nightcape/runs/${date}/state.json\n`, stderr: "", exitCode: 0 };
  }
  unlinkSync(path);
  return { stdout: "state cleared\n", stderr: "", exitCode: 0 };
}
```

- [ ] **Step 5: Implement src/commands/report.ts**

```ts
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export async function runReport(args: { repoRoot: string; date?: string }): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const runsDir = join(args.repoRoot, ".nightcape", "runs");
  if (!existsSync(runsDir)) return { stdout: "", stderr: "no reports on disk\n", exitCode: 1 };
  let date = args.date;
  if (!date) {
    const files = readdirSync(runsDir).filter(f => /^\d{4}-\d{2}-\d{2}\.md$/.test(f)).sort();
    if (files.length === 0) return { stdout: "", stderr: "no reports on disk\n", exitCode: 1 };
    date = files[files.length - 1]!.replace(/\.md$/, "");
  }
  const path = join(runsDir, `${date}.md`);
  if (!existsSync(path)) return { stdout: "", stderr: `no report for ${date}\n`, exitCode: 1 };
  return { stdout: readFileSync(path, "utf8"), stderr: "", exitCode: 0 };
}
```

- [ ] **Step 6: Implement src/commands/stop.ts**

```ts
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { IsAliveFn } from "../lock";

export type KillFn = (pid: number, signal: NodeJS.Signals | number) => void;

export async function runStop(args: { repoRoot: string; killFn?: KillFn; isAlive?: IsAliveFn }): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const path = join(args.repoRoot, ".nightcape", "run.lock");
  if (!existsSync(path)) return { stdout: "nightcape is not running\n", stderr: "", exitCode: 0 };
  const pid = parseInt(readFileSync(path, "utf8").trim(), 10);
  if (!Number.isFinite(pid)) return { stdout: "", stderr: "lockfile malformed\n", exitCode: 1 };
  const isAlive = args.isAlive ?? ((p: number) => { try { process.kill(p, 0); return true; } catch { return false; } });
  if (!isAlive(pid)) return { stdout: "lockfile present but PID not alive — running 'nightcape reset' will clear the lock on next start\n", stderr: "", exitCode: 0 };
  const kill = args.killFn ?? ((p, s) => process.kill(p, s as NodeJS.Signals));
  kill(pid, "SIGTERM");
  return { stdout: `sent SIGTERM to nightcape (pid ${pid}); it will finish the current claude step (up to 30s) then exit\n`, stderr: "", exitCode: 0 };
}
```

- [ ] **Step 7: Wire all four into CLI**

In `src/cli.ts`, add branches for `status`, `reset`, `report`, `stop`. Parse `--archive` for reset and the optional date arg for report.

- [ ] **Step 8: Run tests + lint**

```bash
bun test tests/commands.misc.test.ts
bun run lint
```
Expected: 9 misc-command tests PASS.

- [ ] **Step 9: Commit**

```bash
git add src/commands/ src/cli.ts tests/commands.misc.test.ts
git commit -m "feat: status, reset, report, stop commands"
```

---

## Task 17: start command (queue drain, signal handling)

**Files:**
- Create: `src/commands/start.ts`
- Create: `tests/commands.start.test.ts`

The `start` command is the orchestration of orchestrators. Pseudocode:
1. Acquire lock; abort if held.
2. Run preflight (reuse `runDoctor`); if non-zero exit code, abort.
3. Load (or create) state. If `state.completed` covers `state.queue_snapshot` already, archive and re-init.
4. Honor existing `state.rate_limit_until` if in the future — sleep.
5. Loop: for each issue not yet completed in `state.queue_snapshot`:
   a. Set up SIGTERM handler that sets a `stopRequested` flag.
   b. Call `runIssue`.
   c. If `shouldSleep`, sleep until `sleepUntil` (capped).
   d. If `stopRequested`, break out of the loop after current issue.
6. Finalize the morning report.
7. Release lock.

- [ ] **Step 1: Write the failing tests**

`tests/commands.start.test.ts`:
```ts
import { test, expect } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runStart } from "../src/commands/start";
import { scaffoldConfig } from "../src/config";
import { FakeGh, FakeGit, FakeClaude } from "./fakes/runners";
import { ISSUE_12, ISSUE_13_OPUS, FINAL_JSON_READY, claudeOutputWith } from "./fakes/fixtures";

const tmp = () => mkdtempSync(join(tmpdir(), "nc-"));

test("start drains queue end-to-end (2 issues, both auto-merged)", async () => {
  const dir = tmp();
  scaffoldConfig(dir);
  const gh = new FakeGh(); gh.issues = [ISSUE_12, ISSUE_13_OPUS]; gh.prMergeAcceptedFor.add(100); gh.prMergeAcceptedFor.add(101);
  const git = new FakeGit(); git.repoOk = true; git.remoteOk = true;
  const claude = new FakeClaude(); claude.superpowersInstalled = true;
  claude.responses.push({ stdout: claudeOutputWith({ ...FINAL_JSON_READY, branch: "nightcape/issue-12" }) });
  claude.responses.push({ stdout: claudeOutputWith({ ...FINAL_JSON_READY, branch: "nightcape/issue-13" }) });

  const r = await runStart({
    repoRoot: dir, max: undefined, dryRun: false,
    runners: { gh, git, claude },
    bunVersion: "1.1.0", which: async () => "/bin/cmd",
    sleep: async () => {}, now: () => new Date("2026-04-29T22:00:00Z"),
    onSignal: () => null,
  });

  expect(r.exitCode).toBe(0);
  const state = JSON.parse(readFileSync(join(dir, ".nightcape", "state.json"), "utf8"));
  expect(state.completed).toHaveLength(2);
  expect(state.completed.every((c: any) => c.outcome === "auto_merged")).toBe(true);
  rmSync(dir, { recursive: true });
});

test("start respects --max", async () => {
  const dir = tmp();
  scaffoldConfig(dir);
  const gh = new FakeGh(); gh.issues = [ISSUE_12, ISSUE_13_OPUS]; gh.prMergeAcceptedFor.add(100);
  const git = new FakeGit(); git.repoOk = true; git.remoteOk = true;
  const claude = new FakeClaude(); claude.superpowersInstalled = true;
  claude.responses.push({ stdout: claudeOutputWith({ ...FINAL_JSON_READY, branch: "nightcape/issue-12" }) });

  await runStart({
    repoRoot: dir, max: 1, dryRun: false,
    runners: { gh, git, claude },
    bunVersion: "1.1.0", which: async () => "/bin/cmd",
    sleep: async () => {}, now: () => new Date(),
    onSignal: () => null,
  });

  const state = JSON.parse(readFileSync(join(dir, ".nightcape", "state.json"), "utf8"));
  expect(state.completed).toHaveLength(1);
  rmSync(dir, { recursive: true });
});

test("start --dry-run prints queue and does not call claude.run", async () => {
  const dir = tmp();
  scaffoldConfig(dir);
  const gh = new FakeGh(); gh.issues = [ISSUE_12, ISSUE_13_OPUS];
  const git = new FakeGit(); git.repoOk = true; git.remoteOk = true;
  const claude = new FakeClaude(); claude.superpowersInstalled = true;
  const r = await runStart({
    repoRoot: dir, max: undefined, dryRun: true,
    runners: { gh, git, claude },
    bunVersion: "1.1.0", which: async () => "/bin/cmd",
    sleep: async () => {}, now: () => new Date(),
    onSignal: () => null,
  });
  expect(r.exitCode).toBe(0);
  expect(r.stdout).toContain("would process: #12, #13");
  expect(claude.calls.find(c => c.method === "run")).toBeUndefined();
  rmSync(dir, { recursive: true });
});

test("start aborts if preflight fails (gh not authenticated)", async () => {
  const dir = tmp();
  scaffoldConfig(dir);
  const gh = new FakeGh(); gh.authOk = false;
  const git = new FakeGit(); git.repoOk = true; git.remoteOk = true;
  const claude = new FakeClaude();
  const r = await runStart({
    repoRoot: dir, max: undefined, dryRun: false,
    runners: { gh, git, claude },
    bunVersion: "1.1.0", which: async () => "/bin/cmd",
    sleep: async () => {}, now: () => new Date(),
    onSignal: () => null,
  });
  expect(r.exitCode).toBe(1);
  expect(r.stderr).toContain("preflight");
  rmSync(dir, { recursive: true });
});

test("start: rate-limit causes sleep then resume of same issue", async () => {
  const dir = tmp();
  scaffoldConfig(dir);
  const gh = new FakeGh(); gh.issues = [ISSUE_12]; gh.prMergeAcceptedFor.add(100);
  const git = new FakeGit(); git.repoOk = true; git.remoteOk = true;
  const claude = new FakeClaude(); claude.superpowersInstalled = true;
  // First response: rate-limited. Second: success on retry.
  claude.responses.push({ stdout: "", stderr: "rate_limit_exceeded — Reset at 2026-04-30T03:00:00Z.", exitCode: 1, rateLimited: true, rateLimitUntil: "2026-04-30T03:00:00Z" });
  claude.responses.push({ stdout: claudeOutputWith({ ...FINAL_JSON_READY, branch: "nightcape/issue-12" }) });

  const sleeps: number[] = [];
  await runStart({
    repoRoot: dir, max: undefined, dryRun: false,
    runners: { gh, git, claude },
    bunVersion: "1.1.0", which: async () => "/bin/cmd",
    sleep: async (ms) => { sleeps.push(ms); }, now: () => new Date("2026-04-29T22:00:00Z"),
    onSignal: () => null,
  });
  expect(sleeps.length).toBeGreaterThan(0);
  const state = JSON.parse(readFileSync(join(dir, ".nightcape", "state.json"), "utf8"));
  expect(state.completed).toHaveLength(1);
  expect(state.rate_limit_until).toBeNull(); // cleared after wait
  rmSync(dir, { recursive: true });
});

test("start: previous fully-drained run is archived to runs/<date>/state.json before re-init", async () => {
  const dir = tmp();
  scaffoldConfig(dir);
  // Pre-existing drained state
  const { initState, recordCompletion, saveState } = await import("../src/state");
  let s = initState(dir, [12]);
  s = recordCompletion(s, { issue: 12, outcome: "auto_merged", branch: "b", pr: 1, duration_sec: 60, model: "sonnet" });
  saveState(dir, s);
  const oldRunId = s.run_id;

  const gh = new FakeGh(); gh.issues = [ISSUE_12]; gh.prMergeAcceptedFor.add(100);
  const git = new FakeGit(); git.repoOk = true; git.remoteOk = true;
  const claude = new FakeClaude(); claude.superpowersInstalled = true;
  claude.responses.push({ stdout: claudeOutputWith({ ...FINAL_JSON_READY, branch: "nightcape/issue-12" }) });

  await runStart({
    repoRoot: dir, max: undefined, dryRun: false,
    runners: { gh, git, claude },
    bunVersion: "1.1.0", which: async () => "/bin/cmd",
    sleep: async () => {}, now: () => new Date("2026-04-29T22:00:00Z"),
    onSignal: () => null,
  });

  expect(existsSync(join(dir, ".nightcape", "runs", oldRunId.slice(0, 10), "state.json"))).toBe(true);
  // New state.json exists at root with a fresh run_id
  const fresh = JSON.parse(readFileSync(join(dir, ".nightcape", "state.json"), "utf8"));
  expect(fresh.run_id).not.toBe(oldRunId);
  rmSync(dir, { recursive: true });
});

test("start: SIGTERM during loop ends after current issue", async () => {
  const dir = tmp();
  scaffoldConfig(dir);
  const gh = new FakeGh(); gh.issues = [ISSUE_12, ISSUE_13_OPUS]; gh.prMergeAcceptedFor.add(100);
  const git = new FakeGit(); git.repoOk = true; git.remoteOk = true;
  const claude = new FakeClaude(); claude.superpowersInstalled = true;
  claude.responses.push({ stdout: claudeOutputWith({ ...FINAL_JSON_READY, branch: "nightcape/issue-12" }) });
  // (no response for #13 — should not be reached)

  let calls = 0;
  const r = await runStart({
    repoRoot: dir, max: undefined, dryRun: false,
    runners: { gh, git, claude },
    bunVersion: "1.1.0", which: async () => "/bin/cmd",
    sleep: async () => {}, now: () => new Date(),
    onSignal: () => { calls++; return calls >= 1 ? "stop" : null; },
  });

  expect(r.exitCode).toBe(3); // interrupted
  const state = JSON.parse(readFileSync(join(dir, ".nightcape", "state.json"), "utf8"));
  expect(state.completed).toHaveLength(1); // only #12 finished
  rmSync(dir, { recursive: true });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
bun test tests/commands.start.test.ts
```
Expected: FAIL — module missing.

- [ ] **Step 3: Implement src/commands/start.ts**

```ts
import type { GhRunner, GitRunner, ClaudeRunner } from "../runners/types";
import { loadConfig } from "../config";
import { acquireLock, releaseLock } from "../lock";
import { initState, loadState, saveState, setRateLimit, archiveState } from "../state";
import { runDoctor } from "./doctor";
import { runIssue } from "../orchestrator";
import { initReport, finalizeReport } from "../report";

export type StartArgs = {
  repoRoot: string;
  max?: number;
  dryRun: boolean;
  runners: { gh: GhRunner; git: GitRunner; claude: ClaudeRunner };
  bunVersion: string;
  which: (cmd: string) => Promise<string | null>;
  sleep: (ms: number) => Promise<void>;
  now: () => Date;
  onSignal: () => "stop" | null;
};

export async function runStart(args: StartArgs): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const lock = acquireLock(args.repoRoot);
  if (!lock.acquired) return { stdout: "", stderr: `nightcape is already running (pid ${lock.heldByPid})\n`, exitCode: 1 };
  let stdoutBuf = "";

  try {
    const doc = await runDoctor({ repoRoot: args.repoRoot, runners: args.runners, bunVersion: args.bunVersion, which: args.which });
    if (doc.exitCode !== 0) {
      return { stdout: doc.stdout, stderr: "preflight failed; aborting start\n", exitCode: 1 };
    }
    const cfgRes = loadConfig(args.repoRoot);
    if (!cfgRes.ok) return { stdout: "", stderr: `config invalid: ${cfgRes.reason}\n`, exitCode: 1 };
    const cfg = cfgRes.config;

    const issues = await args.runners.gh.listIssuesByLabel(cfg.label);
    issues.sort((a, b) => a.number - b.number);
    const queue = issues.map(i => i.number);

    if (args.dryRun) {
      stdoutBuf += `would process: ${queue.map(n => "#" + n).join(", ") || "(none)"}\n`;
      return { stdout: stdoutBuf, stderr: "", exitCode: 0 };
    }

    let state = loadState(args.repoRoot);
    if (state && state.completed.length >= state.queue_snapshot.length) {
      // Previous run drained — archive it before starting fresh
      archiveState(args.repoRoot, state.run_id.slice(0, 10));
      state = null;
    }
    if (!state || arraysEqual(state.queue_snapshot, queue) === false) {
      state = initState(args.repoRoot, queue);
    }

    initReport(args.repoRoot, state.run_id.slice(0, 10), args.now());

    // Honor rate-limit at start
    if (state.rate_limit_until && new Date(state.rate_limit_until) > args.now()) {
      const ms = new Date(state.rate_limit_until).getTime() - args.now().getTime();
      stdoutBuf += `rate-limited until ${state.rate_limit_until}; sleeping ${Math.round(ms / 1000)}s\n`;
      await args.sleep(ms);
      state = setRateLimit(state, null);
      saveState(args.repoRoot, state);
    }

    const limit = args.max ?? cfg.max_issues_per_run;
    let processed = 0;
    let interrupted = false;

    for (const n of queue) {
      if (state.completed.some(c => c.issue === n)) continue;
      if (processed >= limit) break;
      if (args.onSignal() === "stop") { interrupted = true; break; }

      let attempts = 0;
      while (attempts < 5) {
        attempts++;
        const result = await runIssue({
          issueNumber: n, repoRoot: args.repoRoot, config: cfg, state,
          runners: args.runners, now: args.now,
        });
        state = result.state;
        if (result.shouldSleep) {
          const until = result.sleepUntil ? new Date(result.sleepUntil).getTime() : args.now().getTime() + 60 * 60 * 1000;
          const ms = Math.max(0, until - args.now().getTime());
          stdoutBuf += `rate-limited; sleeping ${Math.round(ms / 1000)}s${result.sleepUntil ? ` (until ${result.sleepUntil})` : ""}\n`;
          await args.sleep(ms);
          state = setRateLimit(state, null);
          saveState(args.repoRoot, state);
          if (args.onSignal() === "stop") { interrupted = true; break; }
          continue; // retry same issue
        }
        break; // issue completed (any outcome)
      }
      if (interrupted) break;
      processed++;
    }

    finalizeReport(args.repoRoot, state.run_id.slice(0, 10), args.now());
    if (interrupted) return { stdout: stdoutBuf + "interrupted by signal\n", stderr: "", exitCode: 3 };
    return { stdout: stdoutBuf + `done. processed ${processed} issue(s).\n`, stderr: "", exitCode: 0 };
  } finally {
    releaseLock(args.repoRoot);
  }
}

function arraysEqual<T>(a: T[], b: T[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
```

- [ ] **Step 4: Wire `start` into CLI with real signal handling**

In `src/cli.ts`, add the `start` branch:

```ts
if (command === "start") {
  const max = parseFlagInt(argv, "--max");
  const dryRun = argv.includes("--dry-run");
  const cwd = process.cwd();
  let stopRequested = false;
  const sigtermHandler = () => { stopRequested = true; };
  process.on("SIGTERM", sigtermHandler);
  process.on("SIGINT", sigtermHandler);
  const r = await runStart({
    repoRoot: cwd, max, dryRun,
    runners: {
      gh: makeGhRunner({ cwd }),
      git: makeGitRunner({ cwd }),
      claude: makeClaudeRunner(),
    },
    bunVersion: Bun.version,
    which: async (cmd) => {
      const p = Bun.spawn(["which", cmd], { stdout: "pipe", stderr: "pipe" });
      await p.exited;
      const out = (await new Response(p.stdout).text()).trim();
      return out || null;
    },
    sleep: (ms) => new Promise<void>(res => setTimeout(res, Math.min(ms, 6 * 60 * 60 * 1000))),
    now: () => new Date(),
    onSignal: () => stopRequested ? "stop" : null,
  });
  process.off("SIGTERM", sigtermHandler);
  process.off("SIGINT", sigtermHandler);
  return r;
}
```

And add `parseFlagInt` helper at the bottom of cli.ts:
```ts
function parseFlagInt(argv: string[], flag: string): number | undefined {
  const i = argv.indexOf(flag);
  if (i < 0 || i + 1 >= argv.length) return undefined;
  const n = parseInt(argv[i + 1]!, 10);
  return Number.isFinite(n) ? n : undefined;
}
```

- [ ] **Step 5: Run tests + lint**

```bash
bun test tests/commands.start.test.ts
bun run lint
```
Expected: 6 start tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/commands/start.ts src/cli.ts tests/commands.start.test.ts
git commit -m "feat: start command with queue drain, rate-limit waits, signal handling"
```

---

## Task 18: Manual end-to-end validation

**Files:** none (validation only)

This is the final pre-release check the spec calls out. Do this on a personal repo you don't mind nightcape touching.

- [ ] **Step 1: Run the full unit test suite**

```bash
bun test
bun run lint
```
Expected: all tests PASS, no TS errors.

- [ ] **Step 2: Smoke test all CLI commands without arguments**

```bash
bun run bin/nightcape.ts
bun run bin/nightcape.ts help
bun run bin/nightcape.ts --help
bun run bin/nightcape.ts bogus     # should exit 1
```
Expected: first three print the usage text and exit 0; the fourth prints "unknown command 'bogus'" to stderr and exits 1.

- [ ] **Step 3: Doctor in the nightcape repo itself**

```bash
bun run bin/nightcape.ts doctor
```
Expected: most checks pass; config is missing (run init) is the only fail.

- [ ] **Step 4: Init + doctor again**

```bash
bun run bin/nightcape.ts init
cat .nightcape/config.json
cat .gitignore | grep nightcape
bun run bin/nightcape.ts doctor
```
Expected: config scaffolded with defaults; gitignore contains `.nightcape/`; doctor clean (or with documented warns).

- [ ] **Step 5: Dry-run start in a test repo**

Pick a test repo with one or two issues labeled `nightcape`, each referencing a small plan you've written.
```bash
cd /path/to/test-repo
bun /path/to/nightcape/bin/nightcape.ts init
bun /path/to/nightcape/bin/nightcape.ts start --dry-run
```
Expected: prints "would process: #N, #M, ..."; no claude calls; no PRs created.

- [ ] **Step 6: Real run with `--max 1` on a single small issue**

```bash
bun /path/to/nightcape/bin/nightcape.ts start --max 1
```
Expected: runs claude on one issue, creates a PR. Watch stdout for unexpected behavior. Cancel with Ctrl-C if anything looks wrong; verify graceful exit and that `.nightcape/state.json` is consistent.

- [ ] **Step 7: Inspect the morning report and logs**

```bash
bun /path/to/nightcape/bin/nightcape.ts report
ls .nightcape/logs/
```
Expected: report shows the issue's outcome; log file contains claude's stdout.

- [ ] **Step 8: Status / stop / reset**

```bash
bun /path/to/nightcape/bin/nightcape.ts status
# In another terminal: bun /path/to/nightcape/bin/nightcape.ts start --max 1 (let it run)
bun /path/to/nightcape/bin/nightcape.ts stop
bun /path/to/nightcape/bin/nightcape.ts reset
bun /path/to/nightcape/bin/nightcape.ts reset --archive
```
Expected: status reflects each state transition; stop returns immediately and the start process exits gracefully within 30s; reset clears state; reset --archive moves it.

- [ ] **Step 9: Build the bundled binary**

```bash
bun run build
node dist/nightcape.js help
```
Expected: bundled output runs `help` and exits 0. (Useful for distribution; production install path is left to a future README task.)

- [ ] **Step 10: Final commit + tag**

```bash
git tag v0.1.0
git log --oneline | head -25
```

No code changes here — just confirming the commit chain looks clean and the suite is green.

---

## Done

You've built nightcape. To use it overnight:

1. From inside any target repo, run `nightcape init` then `nightcape doctor`.
2. During the day, write specs and plans, commit them, create issues labeled `nightcape` referencing the plan paths.
3. Before bed, run `nightcape start` (likely under `nohup` or in a `tmux` session).
4. Wake up to a queue of merged commits and draft PRs for review.

Future work tracked in the spec under "Open questions / future work."
