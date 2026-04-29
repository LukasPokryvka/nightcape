import type { Issue, FinalJson } from "../../src/types";

export const ISSUE_12: Issue = {
  number: 12,
  title: "Add user search endpoint",
  body: `Add the search endpoint per the plan.

Plan: docs/superpowers/plans/2026-04-25-user-search.md
`,
  labels: ["nightcape"],
};

export const ISSUE_13_OPUS: Issue = {
  number: 13,
  title: "Refactor auth middleware",
  body: "Plan: docs/superpowers/plans/2026-04-25-auth.md",
  labels: ["nightcape", "nightcape:opus"],
};

export const FINAL_JSON_READY: FinalJson = {
  status: "ready_to_merge",
  branch: "nightcape/issue-12",
  lint_passed: true,
  build_passed: true,
  review_findings: [],
  summary: "Implemented user search; tests green; review clean.",
};

export const FINAL_JSON_REVIEW_BLOCKED: FinalJson = {
  status: "ready_to_merge",
  branch: "nightcape/issue-13",
  lint_passed: true,
  build_passed: true,
  review_findings: [
    { severity: "Critical", summary: "Token leaked in logs", file: "auth.ts", line: 42 },
  ],
  summary: "Review blocked by token-leak finding.",
};

export const FINAL_JSON_LINT_FAILED: FinalJson = {
  status: "ready_to_merge",
  branch: "nightcape/issue-14",
  lint_passed: false,
  build_passed: true,
  review_findings: [],
  summary: "Lint failed; please review.",
};

export function claudeOutputWith(json: FinalJson): string {
  return `Doing the work...
Step 1 done.
Step 2 done.

\`\`\`json
${JSON.stringify(json, null, 2)}
\`\`\`
`;
}

export const CLAUDE_RATE_LIMIT_STDERR =
  "Error: rate_limit_exceeded — usage cap reached. Reset at 2026-04-30T03:00:00Z.";
