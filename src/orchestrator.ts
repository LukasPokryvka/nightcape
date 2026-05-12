import { join } from "node:path";
import type { Config, State } from "./types";
import type { GhRunner, GitRunner, ClaudeRunner } from "./runners/types";
import { markInProgress, recordCompletion, setRateLimit, saveState } from "./state";
import { buildPrompt } from "./prompt";
import { parseFinalJson } from "./parse";
import { decideOutcome } from "./gates";
import { initReport, appendIssueOutcome } from "./report";

export type RunIssueArgs = {
  issueNumber: number;
  repoRoot: string;
  config: Config;
  state: State;
  runners: { gh: GhRunner; git: GitRunner; claude: ClaudeRunner };
  now: () => Date;
};

export type RunIssueResult = {
  state: State;
  shouldSleep: boolean;
  sleepUntil?: string | null;
};

export async function runIssue(args: RunIssueArgs): Promise<RunIssueResult> {
  const { issueNumber, repoRoot, config, state: state0, runners, now } = args;
  const startedAt = now();
  let state = markInProgress(state0, issueNumber);
  saveState(repoRoot, state);

  const issue = await runners.gh.getIssue(issueNumber);
  const model: "sonnet" | "opus" = issue.labels.includes("nightcape:opus") ? "opus" : config.default_model;
  const permissionMode = issue.labels.includes("nightcape:safe") ? "acceptEdits" : config.permission_mode;

  const dateLabel = state.run_id.slice(0, 10); // YYYY-MM-DD prefix
  const logPath = join(repoRoot, ".nightcape", "logs", `issue-${issueNumber}-${state.run_id}.log`);
  initReport(repoRoot, dateLabel, startedAt);

  const prompt = buildPrompt({ issue, model, config });
  await runners.git.fetch("origin");

  const cr = await runners.claude.run({
    prompt, model, permissionMode, cwd: repoRoot, logPath,
  });

  if (cr.rateLimited) {
    state = setRateLimit(state, cr.rateLimitUntil);
    saveState(repoRoot, state);
    return { state, shouldSleep: true, sleepUntil: cr.rateLimitUntil };
  }

  const fj = parseFinalJson(cr.stdout);
  const decision = decideOutcome(fj, config);

  // PR creation
  const branch = fj?.branch ?? `nightcape/issue-${issueNumber}`;
  const draft = decision.outcome !== "auto_merged";
  let prNumber: number | undefined;
  try {
    const pr = await runners.gh.createPr({
      title: draft ? `WIP: nightcape #${issueNumber} ${issue.title}` : `nightcape: ${issue.title} (#${issueNumber})`,
      body: buildPrBody(issueNumber, fj, decision.reason),
      head: branch, base: "main", draft,
    });
    prNumber = pr.number;
  } catch (e) {
    // No commits to push, or branch never created. Treat as failed.
    const dur = Math.round((now().getTime() - startedAt.getTime()) / 1000);
    state = recordCompletion(state, {
      issue: issueNumber, outcome: "failed", branch,
      duration_sec: dur, model, reason: `pr-create failed: ${(e as Error).message}`,
    });
    saveState(repoRoot, state);
    appendIssueOutcome(repoRoot, dateLabel, {
      issue: issueNumber, title: issue.title, outcome: "failed",
      branch, model, durationSec: dur,
      lintPassed: fj?.lint_passed ?? false, buildPassed: fj?.build_passed ?? false,
      reviewSummary: "", reason: `pr-create failed`, logPath: logPath,
    });
    return { state, shouldSleep: false };
  }

  let outcome = decision.outcome;
  let reason = decision.reason;

  if (outcome === "auto_merged") {
    const mr = await runners.gh.mergePrSquashAuto(prNumber!);
    if (!mr.ok) {
      outcome = "needs_review";
      reason = `merge call rejected: ${mr.message}`;
    }
  }

  if (outcome !== "auto_merged") {
    await runners.gh.commentIssue(issueNumber, buildIssueComment(prNumber, fj, reason, logPath));
  }

  const dur = Math.round((now().getTime() - startedAt.getTime()) / 1000);
  state = recordCompletion(state, {
    issue: issueNumber, outcome, branch, pr: prNumber,
    duration_sec: dur, model, reason,
  });
  saveState(repoRoot, state);

  appendIssueOutcome(repoRoot, dateLabel, {
    issue: issueNumber, title: issue.title, outcome,
    branch, pr: prNumber, model, durationSec: dur,
    lintPassed: fj?.lint_passed ?? false, buildPassed: fj?.build_passed ?? false,
    reviewSummary: summarizeFindings(fj?.review_findings ?? []), reason,
    logPath: outcome === "auto_merged" ? undefined : logPath,
  });
  return { state, shouldSleep: false };
}

function summarizeFindings(findings: { severity: string; summary: string }[]): string {
  if (findings.length === 0) return "clean";
  const counts: Record<string, number> = {};
  for (const f of findings) counts[f.severity] = (counts[f.severity] ?? 0) + 1;
  return Object.entries(counts).map(([s, n]) => `${n} ${s}`).join(", ");
}

function buildPrBody(issueNumber: number, fj: ReturnType<typeof parseFinalJson>, reason?: string): string {
  const summary = fj?.summary ?? "(claude did not emit a summary)";
  const findings = fj?.review_findings ?? [];
  const findingLines = findings.length === 0 ? "_no findings_" :
    findings.map(f => `- **${f.severity}**: ${f.summary}${f.file ? ` (\`${f.file}${f.line ? ":" + f.line : ""}\`)` : ""}`).join("\n");
  const reasonLine = reason ? `\n\n_nightcape note:_ ${reason}` : "";
  return `Closes #${issueNumber}\n\n## Summary\n${summary}\n\n## Code-review findings\n${findingLines}${reasonLine}\n\n---\n*Opened by nightcape.*`;
}

function buildIssueComment(prNumber: number | undefined, fj: ReturnType<typeof parseFinalJson>, reason?: string, logPath?: string): string {
  const prLink = prNumber ? `PR #${prNumber}` : "(no PR)";
  const r = reason ?? "see attached log";
  const log = logPath ? `\nLog: \`${logPath}\`` : "";
  return `nightcape: ${prLink} — needs review.\nReason: ${r}${log}\n\n_Opened by nightcape (overnight run)._`;
}
