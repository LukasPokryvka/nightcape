export type Severity = "Critical" | "Important" | "Minor";

export type ReviewFinding = {
  severity: Severity;
  summary: string;
  file?: string;
  line?: number;
};

export type FinalJsonStatus = "ready_to_merge" | "needs_review" | "failed";

export type FinalJson = {
  status: FinalJsonStatus;
  branch: string;
  lint_passed: boolean;
  build_passed: boolean;
  review_findings: ReviewFinding[];
  summary: string;
};

export type Config = {
  label: string;
  default_model: "sonnet" | "opus";
  permission_mode: "dangerous" | "acceptEdits" | "default";
  lint: string;
  build: string;
  worktrees_dir: string;
  max_issues_per_run: number;
  blocking_severities: Severity[];
};

export type Outcome = "auto_merged" | "needs_review" | "failed";

export type CompletedEntry = {
  issue: number;
  outcome: Outcome;
  branch: string;
  pr?: number;
  duration_sec: number;
  model: "sonnet" | "opus";
  reason?: string;
};

export type State = {
  version: 1;
  run_id: string;
  started_at: string;            // ISO
  queue_snapshot: number[];
  in_progress: number | null;
  completed: CompletedEntry[];
  rate_limit_until: string | null; // ISO or null
};

export type Issue = {
  number: number;
  title: string;
  body: string;
  labels: string[];
};
