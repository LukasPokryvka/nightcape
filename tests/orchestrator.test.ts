import { test, expect } from "bun:test";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
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
  expect(gh.calls.find(c => c.method === "createPr")).toBeDefined();
  expect((gh.calls.find(c => c.method === "createPr")!.args[0] as any).draft).toBe(false);
  expect(gh.calls.find(c => c.method === "mergePrSquashAuto")).toBeDefined();
  const reportPath = join(dir, ".nightcape", "runs", state.run_id.slice(0, 10) + ".md");
  expect(existsSync(reportPath)).toBe(true);
  const reportContent = readFileSync(reportPath, "utf8");
  expect(reportContent).toContain("#12");
  expect(reportContent).toContain("Add user search endpoint");
  expect(reportContent).toContain("auto-merged");
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
  expect(r.state.completed).toHaveLength(0);
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

test("createPr throws → outcome=failed, state recorded, report appended", async () => {
  const dir = tmp();
  let state = initState(dir, [12]);
  const { gh, git, claude } = setupFakes(claudeOutputWith(FINAL_JSON_READY));
  gh.throwOnCreatePr = "no commits to push";
  const r = await runIssue({
    issueNumber: 12, repoRoot: dir, config: DEFAULT_CONFIG, state,
    runners: { gh, git, claude }, now: () => new Date("2026-04-29T22:00:00Z"),
  });
  expect(r.state.completed.at(-1)?.outcome).toBe("failed");
  expect(r.state.completed.at(-1)?.reason).toContain("pr-create failed");
  expect(r.state.completed.at(-1)?.reason).toContain("no commits to push");
  // Morning report should still be appended
  const reportPath = join(dir, ".nightcape", "runs", state.run_id.slice(0, 10) + ".md");
  expect(existsSync(reportPath)).toBe(true);
  rmSync(dir, { recursive: true });
});
