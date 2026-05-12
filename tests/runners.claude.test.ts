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
