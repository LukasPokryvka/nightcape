import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import type { Outcome } from "./types";

function reportPath(repoRoot: string, date: string): string {
  return join(repoRoot, ".nightcape", "runs", `${date}.md`);
}

function ensureDir(p: string): void { if (!existsSync(p)) mkdirSync(p, { recursive: true }); }

export function initReport(repoRoot: string, date: string, started: Date): string {
  const path = reportPath(repoRoot, date);
  ensureDir(join(repoRoot, ".nightcape", "runs"));
  if (!existsSync(path)) {
    const header = `# nightcape run ${date}\n\nStarted: ${started.toISOString()}\n\n`;
    writeFileSync(path, header);
  }
  return path;
}

export type IssueOutcomeReport = {
  issue: number; title: string;
  outcome: Outcome;
  branch: string; pr?: number;
  model: "sonnet" | "opus";
  durationSec: number;
  lintPassed: boolean; buildPassed: boolean;
  reviewSummary: string;          // human one-liner; empty allowed
  reason?: string;                // failure reason if any
  logPath?: string;
};

const GLYPH: Record<Outcome, string> = {
  auto_merged: "✅ auto-merged",
  needs_review: "🟡 needs review",
  failed: "🔴 failed",
};

export function appendIssueOutcome(repoRoot: string, date: string, r: IssueOutcomeReport): void {
  const path = reportPath(repoRoot, date);
  const lint = r.lintPassed ? "✓" : "✗";
  const build = r.buildPassed ? "✓" : "✗";
  const prText = r.pr ? `PR #${r.pr}` : "(no PR)";
  const reason = r.reason ? `\n- reason: ${r.reason}` : "";
  const log = r.logPath ? `\n- log: ${r.logPath}` : "";
  const review = r.reviewSummary ? `\n- review: ${r.reviewSummary}` : "";
  const block = `\n## #${r.issue} — ${r.title}        ${GLYPH[r.outcome]}\n` +
    `- branch: ${r.branch} · ${prText} · ${r.model} · ${formatDuration(r.durationSec)}\n` +
    `- lint: ${lint} build: ${build}${review}${reason}${log}\n`;
  appendFileSync(path, block);
}

export function finalizeReport(repoRoot: string, date: string, ended: Date): void {
  const path = reportPath(repoRoot, date);
  if (!existsSync(path)) return;
  const body = readFileSync(path, "utf8");
  // Count outcomes already in body
  const counts = {
    auto_merged: (body.match(/✅ auto-merged/g) ?? []).length,
    needs_review: (body.match(/🟡 needs review/g) ?? []).length,
    failed: (body.match(/🔴 failed/g) ?? []).length,
  };
  const startedMatch = body.match(/^Started: (.+)$/m);
  const started = startedMatch ? new Date(startedMatch[1]!) : ended;
  const total = counts.auto_merged + counts.needs_review + counts.failed;
  const dur = formatDuration(Math.round((ended.getTime() - started.getTime()) / 1000));
  const summary = `Ended: ${ended.toISOString()} · Duration: ${dur}\nIssues processed: ${total} · Auto-merged: ${counts.auto_merged} · Needs review: ${counts.needs_review} · Failed: ${counts.failed}\n\n`;
  // Insert after the "Started: ..." line
  const next = body.replace(/^(Started: .+\n)\n?/m, `$1${summary}`);
  writeFileSync(path, next);
}

function formatDuration(sec: number): string {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60), s = sec % 60;
  if (m < 60) return `${m}m${s.toString().padStart(2, "0")}s`;
  const h = Math.floor(m / 60), mm = m % 60;
  return `${h}h${mm.toString().padStart(2, "0")}m`;
}
