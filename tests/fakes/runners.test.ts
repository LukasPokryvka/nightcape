import { test, expect } from "bun:test";
import { FakeGh, FakeGit, FakeClaude } from "./runners";
import { ISSUE_12, claudeOutputWith, FINAL_JSON_READY } from "./fixtures";

test("FakeGh listIssuesByLabel filters by label", async () => {
  const gh = new FakeGh();
  gh.issues = [ISSUE_12];
  const got = await gh.listIssuesByLabel("nightcape");
  expect(got).toEqual([ISSUE_12]);
  expect(gh.calls.at(-1)?.method).toBe("listIssuesByLabel");
});

test("FakeGh mergePrSquashAuto returns ok only if PR pre-approved", async () => {
  const gh = new FakeGh();
  gh.prMergeAcceptedFor.add(101);
  expect((await gh.mergePrSquashAuto(101)).ok).toBe(true);
  expect((await gh.mergePrSquashAuto(102)).ok).toBe(false);
});

test("FakeClaude returns scripted responses in order, throws when empty", async () => {
  const c = new FakeClaude();
  c.responses = [{ stdout: claudeOutputWith(FINAL_JSON_READY), exitCode: 0 }];
  const r = await c.run({ prompt: "x", model: "sonnet", permissionMode: "dangerous", cwd: ".", logPath: "/tmp/x" });
  expect(r.exitCode).toBe(0);
  expect(r.stdout).toContain("ready_to_merge");
  await expect(
    c.run({ prompt: "y", model: "sonnet", permissionMode: "dangerous", cwd: ".", logPath: "/tmp/y" }),
  ).rejects.toThrow("no scripted response");
});

test("FakeGit revParse throws on unknown ref", async () => {
  const g = new FakeGit();
  await expect(g.revParse("nope")).rejects.toThrow("unknown ref");
});
