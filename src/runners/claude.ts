import { existsSync, readdirSync, writeFileSync } from "node:fs";
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
      // Best-effort check — look for the superpowers plugin directory under ~/.claude
      try {
        const home = process.env.HOME ?? "";
        if (!home) return false;
        const dir = `${home}/.claude/plugins/cache/claude-plugins-official`;
        if (!existsSync(dir)) return false;
        return readdirSync(dir).some(name => name.includes("superpowers"));
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
