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
