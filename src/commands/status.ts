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
