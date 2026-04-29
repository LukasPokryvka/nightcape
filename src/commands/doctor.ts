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
