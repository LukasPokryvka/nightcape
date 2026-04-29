import { helpCommand } from "./commands/help";
import { runDoctor } from "./commands/doctor";
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
      which: async (cmd) => {
        const p = Bun.spawn(["which", cmd], { stdout: "pipe", stderr: "pipe" });
        await p.exited;
        const out = (await new Response(p.stdout).text()).trim();
        return out || null;
      },
    });
    return { stdout: r.stdout, stderr: "", exitCode: r.exitCode };
  }

  return {
    stdout: "",
    stderr: `nightcape: unknown command '${command}'\nRun 'nightcape help' for usage.\n`,
    exitCode: 1,
  };
}
