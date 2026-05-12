import type { FinalJson, Config, Outcome } from "./types";

export type Decision = { outcome: Outcome; reason?: string };

export function decideOutcome(fj: FinalJson | null, cfg: Config): Decision {
  if (fj === null) {
    return { outcome: "needs_review", reason: "claude did not emit a parseable final-JSON status block" };
  }
  if (fj.status === "failed") {
    return { outcome: "failed", reason: fj.summary || "claude reported failed" };
  }
  if (fj.status === "needs_review") {
    return { outcome: "needs_review", reason: fj.summary || "claude reported needs_review" };
  }
  // status === "ready_to_merge"
  if (!fj.lint_passed) return { outcome: "needs_review", reason: "lint failed" };
  if (!fj.build_passed) return { outcome: "needs_review", reason: "build failed" };

  const blocking = new Set(cfg.blocking_severities);
  const blockers = fj.review_findings.filter(f => blocking.has(f.severity));
  if (blockers.length > 0) {
    const counts = countBy(blockers, f => f.severity);
    const summary = Object.entries(counts).map(([sev, n]) => `${n} ${sev}`).join(", ");
    return { outcome: "needs_review", reason: `code-review found ${summary} finding(s)` };
  }
  return { outcome: "auto_merged" };
}

function countBy<T, K extends string>(arr: T[], keyFn: (x: T) => K): Record<K, number> {
  const out = {} as Record<K, number>;
  for (const x of arr) {
    const k = keyFn(x);
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}
