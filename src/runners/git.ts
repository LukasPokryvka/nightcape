import type { GitRunner } from "./types";
import { defaultSpawn, type SpawnFn } from "./gh";

export function makeGitRunner(deps: { cwd: string; spawn?: SpawnFn }): GitRunner {
  const spawn = deps.spawn ?? defaultSpawn;
  const cwd = deps.cwd;

  return {
    async isRepo() {
      const r = await spawn(["git", "rev-parse", "--is-inside-work-tree"], { cwd });
      return r.exitCode === 0 && r.stdout.trim() === "true";
    },
    async hasRemote() {
      const r = await spawn(["git", "remote"], { cwd });
      return r.exitCode === 0 && r.stdout.trim().length > 0;
    },
    async fetch(remote) {
      const r = await spawn(["git", "fetch", remote], { cwd });
      if (r.exitCode !== 0) throw new Error(`git fetch ${remote} failed: ${r.stderr}`);
    },
    async revParse(ref) {
      const r = await spawn(["git", "rev-parse", ref], { cwd });
      if (r.exitCode !== 0) throw new Error(`git rev-parse ${ref} failed: ${r.stderr}`);
      return r.stdout.trim();
    },
    // Local-only check; for remote-tracking refs use revParse("refs/remotes/origin/<name>")
    async branchExists(name) {
      const r = await spawn(["git", "branch", "--list", name], { cwd });
      return r.exitCode === 0 && r.stdout.trim().length > 0;
    },
  };
}
