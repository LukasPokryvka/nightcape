import { test, expect } from "bun:test";
import { buildPrompt } from "../src/prompt";
import { ISSUE_12, ISSUE_13_OPUS } from "./fakes/fixtures";
import { DEFAULT_CONFIG } from "../src/config";

test("buildPrompt includes issue number, title, body verbatim", () => {
  const p = buildPrompt({ issue: ISSUE_12, model: "sonnet", config: DEFAULT_CONFIG });
  expect(p).toContain("Issue #12");
  expect(p).toContain("Add user search endpoint");
  expect(p).toContain("docs/superpowers/plans/2026-04-25-user-search.md");
});

test("buildPrompt names the branch nightcape/issue-N", () => {
  const p = buildPrompt({ issue: ISSUE_12, model: "sonnet", config: DEFAULT_CONFIG });
  expect(p).toContain("nightcape/issue-12");
});

test("buildPrompt instructs Claude to invoke the named superpowers skills", () => {
  const p = buildPrompt({ issue: ISSUE_12, model: "sonnet", config: DEFAULT_CONFIG });
  expect(p).toContain("executing-plans");
  expect(p).toContain("subagent-driven-development");
  expect(p).toContain("requesting-code-review");
  expect(p).toContain("using-git-worktrees");
});

test("buildPrompt embeds the configured lint and build commands", () => {
  const p = buildPrompt({ issue: ISSUE_12, model: "sonnet", config: DEFAULT_CONFIG });
  expect(p).toContain(DEFAULT_CONFIG.lint);
  expect(p).toContain(DEFAULT_CONFIG.build);
});

test("buildPrompt embeds the FinalJson schema verbatim and severity vocabulary", () => {
  const p = buildPrompt({ issue: ISSUE_12, model: "sonnet", config: DEFAULT_CONFIG });
  expect(p).toContain('"status"');
  expect(p).toContain("ready_to_merge");
  expect(p).toContain("needs_review");
  expect(p).toContain("Critical");
  expect(p).toContain("Important");
  expect(p).toContain("Minor");
});

test("buildPrompt skips lint/build instructions when commands are empty strings", () => {
  const cfg = { ...DEFAULT_CONFIG, lint: "", build: "" };
  const p = buildPrompt({ issue: ISSUE_12, model: "sonnet", config: cfg });
  expect(p).toContain('"lint_passed": true   // no lint configured');
  expect(p).toContain('"build_passed": true');
});

test("buildPrompt is deterministic for same inputs (snapshot)", () => {
  const a = buildPrompt({ issue: ISSUE_12, model: "sonnet", config: DEFAULT_CONFIG });
  const b = buildPrompt({ issue: ISSUE_12, model: "sonnet", config: DEFAULT_CONFIG });
  expect(a).toBe(b);
});
