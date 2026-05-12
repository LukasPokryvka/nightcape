import { existsSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { scaffoldConfig } from "../config";

export async function runInit(args: { repoRoot: string }): Promise<{ stdout: string; exitCode: number }> {
  scaffoldConfig(args.repoRoot);
  ensureGitignoreEntry(args.repoRoot);
  return {
    stdout: `nightcape: scaffolded ${join(".nightcape", "config.json")} and updated .gitignore.\n` +
            `Run 'nightcape doctor' to verify your environment.\n`,
    exitCode: 0,
  };
}

function ensureGitignoreEntry(repoRoot: string) {
  const giPath = join(repoRoot, ".gitignore");
  if (!existsSync(giPath)) {
    writeFileSync(giPath, ".nightcape/\n");
    return;
  }
  const cur = readFileSync(giPath, "utf8");
  if (cur.split("\n").some(l => l.trim() === ".nightcape/")) return;
  appendFileSync(giPath, (cur.endsWith("\n") ? "" : "\n") + ".nightcape/\n");
}
