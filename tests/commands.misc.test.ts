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
  s = { ...s, in_progress: 13 };
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
