import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { isLockHeld, type IsAliveFn } from "../lock";
import { archiveState } from "../state";

export async function runReset(args: { repoRoot: string; archive: boolean; today?: string; isAlive?: IsAliveFn }): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  if (isLockHeld(args.repoRoot, args.isAlive)) {
    return { stdout: "", stderr: "nightcape: refusing to reset — a nightcape run is currently running. Stop it first ('nightcape stop').\n", exitCode: 1 };
  }
  const path = join(args.repoRoot, ".nightcape", "state.json");
  if (!existsSync(path)) return { stdout: "nothing to reset\n", stderr: "", exitCode: 0 };
  if (args.archive) {
    const date = args.today ?? new Date().toISOString().slice(0, 10);
    archiveState(args.repoRoot, date);
    return { stdout: `archived state to .nightcape/runs/${date}/state.json\n`, stderr: "", exitCode: 0 };
  }
  unlinkSync(path);
  return { stdout: "state cleared\n", stderr: "", exitCode: 0 };
}
