import type { Config, Issue } from "./types";

export type BuildPromptArgs = {
  issue: Issue;
  model: "sonnet" | "opus";
  config: Config;
};

export function buildPrompt({ issue, model, config }: BuildPromptArgs): string {
  const branch = `nightcape/issue-${issue.number}`;
  const lintBlock = config.lint
    ? `Run the lint command: \`${config.lint}\`. Capture pass/fail in lint_passed.`
    : `No lint command is configured. Set "lint_passed": true   // no lint configured`;
  const buildBlock = config.build
    ? `Run the build command: \`${config.build}\`. Capture pass/fail in build_passed.`
    : `No build command is configured. Set "build_passed": true   // no build configured`;

  return `You are nightcape's overnight executor for a single GitHub issue.

# Issue #${issue.number}: ${issue.title}

\`\`\`
${issue.body}
\`\`\`

# Your job (do all of it, in this order)

1. Read the issue body above. It references a plan (a markdown file under docs/). Read that plan in full.
2. Use the **using-git-worktrees** skill to create a fresh worktree. Branch name: \`${branch}\`.
3. Inside the worktree, execute the plan using **executing-plans** + **subagent-driven-development**. Make commits as you go (small, frequent).
4. ${lintBlock}
5. ${buildBlock}
6. Run **requesting-code-review** on your final commit range. Capture findings as an array of { severity, summary, file?, line? }, where severity is exactly "Critical", "Important", or "Minor".
7. Push the branch \`${branch}\` to origin.
8. Decide the status:
   - "ready_to_merge" if the work is complete and you believe a maintainer would merge it
   - "needs_review" if work is complete but you have reservations (or steps couldn't be fully verified)
   - "failed" if you could not complete the work

# Output contract (mandatory)

End your output with a single \`\`\`json\`\`\` fenced block matching this schema EXACTLY:

\`\`\`json
{
  "status": "ready_to_merge" | "needs_review" | "failed",
  "branch": "${branch}",
  "lint_passed": true,
  "build_passed": true,
  "review_findings": [
    { "severity": "Critical" | "Important" | "Minor", "summary": "...", "file": "path", "line": 42 }
  ],
  "summary": "one paragraph"
}
\`\`\`

If you do not emit this block, nightcape will mark the issue as needs_review and open a draft PR. Be honest in your status — nightcape's gate will second-guess you anyway.

Model: ${model}.
`;
}
