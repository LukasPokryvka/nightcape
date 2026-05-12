export const HELP_TEXT = `nightcape — overnight superpowers executor

Usage: nightcape <command> [options]

Commands:
  help                Print this help text
  doctor              Run preflight checks
  init                Scaffold .nightcape/config.json
  start [--max N] [--dry-run]
                      Drain the issue queue
  status              Print current run state
  stop                Gracefully stop a running nightcape
  reset [--archive]   Clear state.json
  report [<date>]     Print morning report

Run 'nightcape doctor' before your first 'nightcape start'.
`;

export async function helpCommand(): Promise<{ stdout: string; exitCode: number }> {
  return { stdout: HELP_TEXT, exitCode: 0 };
}
