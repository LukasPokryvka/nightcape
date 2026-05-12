import type { FinalJson, ReviewFinding, Severity } from "./types";

const VALID_STATUS = new Set(["ready_to_merge", "needs_review", "failed"]);
const VALID_SEV = new Set<Severity>(["Critical", "Important", "Minor"]);

const FENCE_RE = /```json\s*\n([\s\S]*?)\n```/g;

export function parseFinalJson(stdout: string): FinalJson | null {
  const matches = [...stdout.matchAll(FENCE_RE)];
  if (matches.length === 0) return null;
  const last = matches[matches.length - 1]!;
  const raw = last[1] ?? "";
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return null; }
  if (!parsed || typeof parsed !== "object") return null;
  const o = parsed as Record<string, unknown>;

  if (!VALID_STATUS.has(o.status as string)) return null;
  if (typeof o.branch !== "string" || o.branch.length === 0) return null;
  if (typeof o.lint_passed !== "boolean") return null;
  if (typeof o.build_passed !== "boolean") return null;
  if (typeof o.summary !== "string") return null;

  let findings: ReviewFinding[] = [];
  if (o.review_findings !== undefined) {
    if (!Array.isArray(o.review_findings)) return null;
    for (const f of o.review_findings as unknown[]) {
      if (!f || typeof f !== "object") return null;
      const fo = f as Record<string, unknown>;
      if (!VALID_SEV.has(fo.severity as Severity)) return null;
      if (typeof fo.summary !== "string") return null;
      findings.push({
        severity: fo.severity as Severity,
        summary: fo.summary,
        file: typeof fo.file === "string" ? fo.file : undefined,
        line: typeof fo.line === "number" ? fo.line : undefined,
      });
    }
  }

  return {
    status: o.status as FinalJson["status"],
    branch: o.branch,
    lint_passed: o.lint_passed,
    build_passed: o.build_passed,
    review_findings: findings,
    summary: o.summary,
  };
}
