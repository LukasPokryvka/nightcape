import { test, expect } from "bun:test";
import { decideOutcome } from "../src/gates";
import { DEFAULT_CONFIG } from "../src/config";
import {
  FINAL_JSON_READY, FINAL_JSON_REVIEW_BLOCKED, FINAL_JSON_LINT_FAILED,
} from "./fakes/fixtures";

test("auto_merge when status=ready, lint+build pass, no blocking findings", () => {
  expect(decideOutcome(FINAL_JSON_READY, DEFAULT_CONFIG)).toEqual({ outcome: "auto_merged" });
});

test("needs_review when status=ready but lint failed", () => {
  const r = decideOutcome(FINAL_JSON_LINT_FAILED, DEFAULT_CONFIG);
  expect(r.outcome).toBe("needs_review");
  expect(r.reason).toContain("lint");
});

test("needs_review when status=ready but a Critical finding present", () => {
  const r = decideOutcome(FINAL_JSON_REVIEW_BLOCKED, DEFAULT_CONFIG);
  expect(r.outcome).toBe("needs_review");
  expect(r.reason).toContain("Critical");
});

test("needs_review when status=needs_review regardless of lint/build", () => {
  const r = decideOutcome({ ...FINAL_JSON_READY, status: "needs_review" }, DEFAULT_CONFIG);
  expect(r.outcome).toBe("needs_review");
});

test("failed when status=failed", () => {
  const r = decideOutcome({ ...FINAL_JSON_READY, status: "failed", summary: "broke" }, DEFAULT_CONFIG);
  expect(r.outcome).toBe("failed");
  expect(r.reason).toContain("broke");
});

test("Minor findings do not block when blocking_severities=[Critical,Important]", () => {
  const fj = { ...FINAL_JSON_READY, review_findings: [{ severity: "Minor" as const, summary: "nit" }] };
  expect(decideOutcome(fj, DEFAULT_CONFIG).outcome).toBe("auto_merged");
});

test("custom blocking_severities=[Minor] makes Minor findings block", () => {
  const fj = { ...FINAL_JSON_READY, review_findings: [{ severity: "Minor" as const, summary: "nit" }] };
  const cfg: typeof DEFAULT_CONFIG = { ...DEFAULT_CONFIG, blocking_severities: ["Minor"] };
  expect(decideOutcome(fj, cfg).outcome).toBe("needs_review");
});

test("null FinalJson (parse failure) returns needs_review with reason", () => {
  expect(decideOutcome(null, DEFAULT_CONFIG)).toEqual({
    outcome: "needs_review",
    reason: "claude did not emit a parseable final-JSON status block",
  });
});
