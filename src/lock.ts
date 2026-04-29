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
