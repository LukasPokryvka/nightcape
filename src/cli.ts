import { helpCommand } from "./commands/help";
import { runDoctor } from "./commands/doctor";
import { runInit } from "./commands/init";
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

  return {
    stdout: "",
    stderr: `nightcape: unknown command '${command}'\nRun 'nightcape help' for usage.\n`,
    exitCode: 1,
  };
}
