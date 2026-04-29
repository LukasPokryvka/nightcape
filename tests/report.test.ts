import { test, expect } from "bun:test";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initReport, appendIssueOutcome, finalizeReport } from "../src/report";

const tmp = () => mkdtempSync(join(tmpdir(), "nc-"));

test("initReport creates the file with header for the date", () => {
  const dir = tmp();
  const path = initReport(dir, "2026-04-29", new Date("2026-04-29T22:00:00Z"));
  expect(existsSync(path)).toBe(true);
  const content = readFileSync(path, "utf8");
  expect(content).toContain("# nightcape run 2026-04-29");
  expect(content).toContain("Started: ");
  rmSync(dir, { recursive: true });
});

test("appendIssueOutcome adds a section per issue with outcome glyph", () => {
  const dir = tmp();
  const path = initReport(dir, "2026-04-29", new Date("2026-04-29T22:00:00Z"));
  appendIssueOutcome(dir, "2026-04-29", {
    issue: 12, title: "Add search", outcome: "auto_merged",
    branch: "nightcape/issue-12", pr: 47, model: "sonnet",
    durationSec: 612, lintPassed: true, buildPassed: true, reviewSummary: "clean",
  });
  appendIssueOutcome(dir, "2026-04-29", {
    issue: 13, title: "Refactor auth", outcome: "needs_review",
    branch: "nightcape/issue-13", pr: 48, model: "sonnet",
    durationSec: 1080, lintPassed: true, buildPassed: true,
    reviewSummary: "1 Critical (token-leak)", reason: "code-review found 1 Critical finding",
    logPath: ".nightcape/logs/issue-13.log",
  });
  const c = readFileSync(path, "utf8");
  expect(c).toContain("## #12 — Add search");
  expect(c).toContain("auto-merged");
  expect(c).toContain("PR #47");
  expect(c).toContain("## #13 — Refactor auth");
  expect(c).toContain("needs review");
  expect(c).toContain("token-leak");
  rmSync(dir, { recursive: true });
});

test("finalizeReport writes a summary line at top once duration known", () => {
  const dir = tmp();
  initReport(dir, "2026-04-29", new Date("2026-04-29T22:00:00Z"));
  appendIssueOutcome(dir, "2026-04-29", {
    issue: 12, title: "x", outcome: "auto_merged", branch: "b", pr: 1,
    model: "sonnet", durationSec: 60, lintPassed: true, buildPassed: true, reviewSummary: "",
  });
  finalizeReport(dir, "2026-04-29", new Date("2026-04-30T04:18:00Z"));
  const c = readFileSync(join(dir, ".nightcape", "runs", "2026-04-29.md"), "utf8");
  expect(c).toContain("Ended:");
  expect(c).toContain("Auto-merged: 1");
  rmSync(dir, { recursive: true });
});
