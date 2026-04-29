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

test("doctor fails when run.lock is held by a live PID", async () => {
  const { writeFileSync, mkdirSync } = await import("node:fs");
  const dir = tmp();
  scaffoldConfig(dir);
  mkdirSync(join(dir, ".nightcape"), { recursive: true });
  writeFileSync(join(dir, ".nightcape", "run.lock"), String(process.pid) + "\n");
  const r = await runDoctor({
    repoRoot: dir, runners: { gh: new FakeGh(), git: makeHealthyGit(), claude: makeHealthyClaude() },
    bunVersion: "1.1.0", which: async () => "/usr/local/bin/cmd",
  });
  expect(r.exitCode).toBe(1);
  expect(r.stdout).toContain("run.lock");
  rmSync(dir, { recursive: true });
});

function makeHealthyGit() { const g = new FakeGit(); g.repoOk = true; g.remoteOk = true; return g; }
function makeHealthyClaude() { const c = new FakeClaude(); c.superpowersInstalled = true; return c; }
