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
  expect(state.rate_limit_until).toBeNull();
  rmSync(dir, { recursive: true });
});

test("start: previous fully-drained run is archived to runs/<date>/state.json before re-init", async () => {
  const dir = tmp();
  scaffoldConfig(dir);
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

  let calls = 0;
  const r = await runStart({
    repoRoot: dir, max: undefined, dryRun: false,
    runners: { gh, git, claude },
    bunVersion: "1.1.0", which: async () => "/bin/cmd",
    sleep: async () => {}, now: () => new Date(),
    onSignal: () => { calls++; return calls >= 1 ? "stop" : null; },
  });

  expect(r.exitCode).toBe(3);
  const state = JSON.parse(readFileSync(join(dir, ".nightcape", "state.json"), "utf8"));
  expect(state.completed).toHaveLength(1);
  rmSync(dir, { recursive: true });
});
