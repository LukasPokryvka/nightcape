import type { GhRunner, GitRunner, ClaudeRunner } from "../runners/types";
import { loadConfig } from "../config";
import { acquireLock, releaseLock } from "../lock";
import { initState, loadState, saveState, setRateLimit, archiveState } from "../state";
import { runDoctor } from "./doctor";
import { runIssue } from "../orchestrator";
import { initReport, finalizeReport } from "../report";

export type StartArgs = {
  repoRoot: string;
  max?: number;
  dryRun: boolean;
  runners: { gh: GhRunner; git: GitRunner; claude: ClaudeRunner };
  bunVersion: string;
  which: (cmd: string) => Promise<string | null>;
  sleep: (ms: number) => Promise<void>;
  now: () => Date;
  onSignal: () => "stop" | null;
};

export async function runStart(args: StartArgs): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  // Run preflight BEFORE acquiring the lock so doctor's isLockHeld check doesn't self-fail
  const doc = await runDoctor({ repoRoot: args.repoRoot, runners: args.runners, bunVersion: args.bunVersion, which: args.which });
  if (doc.exitCode !== 0) {
    return { stdout: doc.stdout, stderr: "preflight failed; aborting start\n", exitCode: 1 };
  }

  const lock = acquireLock(args.repoRoot);
  if (!lock.acquired) return { stdout: "", stderr: `nightcape is already running (pid ${(lock as { acquired: false; heldByPid: number }).heldByPid})\n`, exitCode: 1 };
  let stdoutBuf = "";

  try {
    const cfgRes = loadConfig(args.repoRoot);
    if (!cfgRes.ok) return { stdout: "", stderr: `config invalid: ${cfgRes.reason}\n`, exitCode: 1 };
    const cfg = cfgRes.config;

    const issues = await args.runners.gh.listIssuesByLabel(cfg.label);
    issues.sort((a, b) => a.number - b.number);
    const queue = issues.map(i => i.number);

    if (args.dryRun) {
      stdoutBuf += `would process: ${queue.map(n => "#" + n).join(", ") || "(none)"}\n`;
      return { stdout: stdoutBuf, stderr: "", exitCode: 0 };
    }

    let state = loadState(args.repoRoot);
    if (state && state.completed.length >= state.queue_snapshot.length && state.queue_snapshot.length > 0) {
      // Previous run drained — archive it before starting fresh
      archiveState(args.repoRoot, state.run_id.slice(0, 10));
      state = null;
    }
    if (!state || !arraysEqual(state.queue_snapshot, queue)) {
      state = initState(args.repoRoot, queue, args.now());
    }

    initReport(args.repoRoot, state.run_id.slice(0, 10), args.now());

    // Honor rate-limit at start
    if (state.rate_limit_until && new Date(state.rate_limit_until) > args.now()) {
      const ms = new Date(state.rate_limit_until).getTime() - args.now().getTime();
      stdoutBuf += `rate-limited until ${state.rate_limit_until}; sleeping ${Math.round(ms / 1000)}s\n`;
      await args.sleep(ms);
      state = setRateLimit(state, null);
      saveState(args.repoRoot, state);
    }

    const limit = args.max ?? cfg.max_issues_per_run;
    let processed = 0;
    let interrupted = false;

    for (const n of queue) {
      if (state.completed.some(c => c.issue === n)) continue;
      if (processed >= limit) break;

      let attempts = 0;
      while (attempts < 5) {
        attempts++;
        const result = await runIssue({
          issueNumber: n, repoRoot: args.repoRoot, config: cfg, state,
          runners: args.runners, now: args.now,
        });
        state = result.state;
        if (result.shouldSleep) {
          const until = result.sleepUntil ? new Date(result.sleepUntil).getTime() : args.now().getTime() + 60 * 60 * 1000;
          const ms = Math.max(0, until - args.now().getTime());
          stdoutBuf += `rate-limited; sleeping ${Math.round(ms / 1000)}s${result.sleepUntil ? ` (until ${result.sleepUntil})` : ""}\n`;
          await args.sleep(ms);
          state = setRateLimit(state, null);
          saveState(args.repoRoot, state);
          if (args.onSignal() === "stop") { interrupted = true; break; }
          continue;
        }
        break;
      }
      processed++;
      // Check signal AFTER completing current issue so we finish it before stopping
      if (interrupted || args.onSignal() === "stop") { interrupted = true; break; }
    }

    finalizeReport(args.repoRoot, state.run_id.slice(0, 10), args.now());
    if (interrupted) return { stdout: stdoutBuf + "interrupted by signal\n", stderr: "", exitCode: 3 };
    return { stdout: stdoutBuf + `done. processed ${processed} issue(s).\n`, stderr: "", exitCode: 0 };
  } finally {
    releaseLock(args.repoRoot);
  }
}

function arraysEqual<T>(a: T[], b: T[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
