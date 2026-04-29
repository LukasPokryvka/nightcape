import { helpCommand } from "./commands/help";

export type CliResult = { stdout: string; stderr: string; exitCode: number };

export async function runCli(argv: string[]): Promise<CliResult> {
  const command = argv[0] ?? "help";

  if (command === "help" || command === "--help" || command === "-h") {
    const { stdout, exitCode } = await helpCommand();
    return { stdout, stderr: "", exitCode };
  }

  return {
    stdout: "",
    stderr: `nightcape: unknown command '${command}'\nRun 'nightcape help' for usage.\n`,
    exitCode: 1,
  };
}
