import { helpCommand } from "./commands/help";
import { runDoctor } from "./commands/doctor";
import { runInit } from "./commands/init";
import { runStatus } from "./commands/status";
import { runReset } from "./commands/reset";
import { runReport } from "./commands/report";
import { runStop } from "./commands/stop";
import { runStart } from "./commands/start";
import { makeGhRunner } from "./runners/gh";
import { makeGitRunner } from "./runners/git";
import { makeClaudeRunner } from "./runners/claude";

export type CliResult = { stdout: string; stderr: string; exitCode: number };

export async function runCli(argv: string[]): Promise<CliResult> {
  const command = argv[0] ?? "help";

  if (command === "help" || command === "--help" || command === "-h") {
    const { stdout, exitCode } = await helpCommand();
    return { stdout, stderr: "", exitCode };
  }

  if (command === "doctor") {
    const cwd = process.cwd();
    const r = await runDoctor({
      repoRoot: cwd,
      runners: {
        gh: makeGhRunner({ cwd }),
        git: makeGitRunner({ cwd }),
        claude: makeClaudeRunner(),
      },
      bunVersion: Bun.version,
      which: async (cmd) => Bun.which(cmd) ?? null,
    });
    return { stdout: r.stdout, stderr: "", exitCode: r.exitCode };
  }

  if (command === "init") {
    const r = await runInit({ repoRoot: process.cwd() });
    return { stdout: r.stdout, stderr: "", exitCode: r.exitCode };
  }

  if (command === "status") {
    const r = await runStatus({ repoRoot: process.cwd() });
    return { stdout: r.stdout, stderr: "", exitCode: r.exitCode };
  }

  if (command === "reset") {
    const archive = argv.includes("--archive");
    const r = await runReset({ repoRoot: process.cwd(), archive });
    return { stdout: r.stdout, stderr: r.stderr, exitCode: r.exitCode };
  }

  if (command === "report") {
    const date = argv[1]; // optional date arg
    const r = await runReport({ repoRoot: process.cwd(), date });
    return { stdout: r.stdout, stderr: r.stderr, exitCode: r.exitCode };
  }

  if (command === "stop") {
    const r = await runStop({ repoRoot: process.cwd() });
    return { stdout: r.stdout, stderr: r.stderr, exitCode: r.exitCode };
  }

  if (command === "start") {
    const max = parseFlagInt(argv, "--max");
    const dryRun = argv.includes("--dry-run");
    const cwd = process.cwd();
    let stopRequested = false;
    const sigtermHandler = () => { stopRequested = true; };
    process.on("SIGTERM", sigtermHandler);
    process.on("SIGINT", sigtermHandler);
    const r = await runStart({
      repoRoot: cwd, max, dryRun,
      runners: {
        gh: makeGhRunner({ cwd }),
        git: makeGitRunner({ cwd }),
        claude: makeClaudeRunner(),
      },
      bunVersion: Bun.version,
      which: async (cmd) => Bun.which(cmd) ?? null,
      sleep: (ms) => new Promise<void>(res => setTimeout(res, Math.min(ms, 6 * 60 * 60 * 1000))),
      now: () => new Date(),
      onSignal: () => stopRequested ? "stop" : null,
    });
    (process as any).off("SIGTERM", sigtermHandler);
    (process as any).off("SIGINT", sigtermHandler);
    return r;
  }

  return {
    stdout: "",
    stderr: `nightcape: unknown command '${command}'\nRun 'nightcape help' for usage.\n`,
    exitCode: 1,
  };
}

function parseFlagInt(argv: string[], flag: string): number | undefined {
  const i = argv.indexOf(flag);
  if (i < 0 || i + 1 >= argv.length) return undefined;
  const n = parseInt(argv[i + 1]!, 10);
  return Number.isFinite(n) ? n : undefined;
}
