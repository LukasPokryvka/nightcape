import { test, expect } from "bun:test";
import { makeGhRunner } from "../src/runners/gh";
import { makeGitRunner } from "../src/runners/git";

type SpawnCall = { cmd: string[]; cwd: string };

function makeFakeSpawn(scripts: { match: (cmd: string[]) => boolean; stdout: string; stderr?: string; exitCode?: number }[]) {
  const calls: SpawnCall[] = [];
  return {
    calls,
    spawn: async (cmd: string[], opts: { cwd: string }) => {
      calls.push({ cmd, cwd: opts.cwd });
      const m = scripts.find(s => s.match(cmd));
      if (!m) throw new Error(`unscripted spawn: ${cmd.join(" ")}`);
      return { stdout: m.stdout, stderr: m.stderr ?? "", exitCode: m.exitCode ?? 0 };
    },
  };
}

test("gh.listIssuesByLabel calls gh issue list with --label and --json", async () => {
  const fake = makeFakeSpawn([
    { match: cmd => cmd[0] === "gh" && cmd[1] === "issue" && cmd[2] === "list",
      stdout: JSON.stringify([{ number: 12, title: "t", body: "b", labels: [{ name: "nightcape" }] }]) },
  ]);
  const gh = makeGhRunner({ cwd: "/repo", spawn: fake.spawn });
  const got = await gh.listIssuesByLabel("nightcape");
  expect(got).toEqual([{ number: 12, title: "t", body: "b", labels: ["nightcape"] }]);
  expect(fake.calls[0]!.cmd).toContain("--label");
  expect(fake.calls[0]!.cmd).toContain("nightcape");
  expect(fake.calls[0]!.cmd).toContain("--json");
});

test("gh.mergePrSquashAuto calls gh pr merge --squash --auto", async () => {
  const fake = makeFakeSpawn([
    { match: cmd => cmd[0] === "gh" && cmd[1] === "pr" && cmd[2] === "merge", stdout: "" },
  ]);
  const gh = makeGhRunner({ cwd: "/repo", spawn: fake.spawn });
  const r = await gh.mergePrSquashAuto(47);
  expect(r.ok).toBe(true);
  expect(fake.calls[0]!.cmd).toContain("--squash");
  expect(fake.calls[0]!.cmd).toContain("--auto");
  expect(fake.calls[0]!.cmd).toContain("47");
});

test("git.fetch calls git fetch <remote>", async () => {
  const fake = makeFakeSpawn([
    { match: cmd => cmd[0] === "git" && cmd[1] === "fetch", stdout: "" },
  ]);
  const git = makeGitRunner({ cwd: "/repo", spawn: fake.spawn });
  await git.fetch("origin");
  expect(fake.calls[0]!.cmd).toEqual(["git", "fetch", "origin"]);
});

test("git.revParse returns trimmed sha", async () => {
  const fake = makeFakeSpawn([
    { match: cmd => cmd[0] === "git" && cmd[1] === "rev-parse", stdout: "deadbeef\n" },
  ]);
  const git = makeGitRunner({ cwd: "/repo", spawn: fake.spawn });
  expect(await git.revParse("HEAD")).toBe("deadbeef");
});
