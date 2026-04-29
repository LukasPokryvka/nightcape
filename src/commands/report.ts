import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export async function runReport(args: { repoRoot: string; date?: string }): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const runsDir = join(args.repoRoot, ".nightcape", "runs");
  if (!existsSync(runsDir)) return { stdout: "", stderr: "no reports on disk\n", exitCode: 1 };
  let date = args.date;
  if (!date) {
    const files = readdirSync(runsDir).filter(f => /^\d{4}-\d{2}-\d{2}\.md$/.test(f)).sort();
    if (files.length === 0) return { stdout: "", stderr: "no reports on disk\n", exitCode: 1 };
    date = files[files.length - 1]!.replace(/\.md$/, "");
  }
  const path = join(runsDir, `${date}.md`);
  if (!existsSync(path)) return { stdout: "", stderr: `no report for ${date}\n`, exitCode: 1 };
  return { stdout: readFileSync(path, "utf8"), stderr: "", exitCode: 0 };
}
