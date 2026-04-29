import type { GhRunner } from "./types";

export type SpawnFn = (cmd: string[], opts: { cwd: string; stdin?: string }) =>
  Promise<{ stdout: string; stderr: string; exitCode: number }>;

export async function defaultSpawn(cmd: string[], opts: { cwd: string; stdin?: string }) {
  const proc = Bun.spawn(cmd, { cwd: opts.cwd, stdin: opts.stdin ? new TextEncoder().encode(opts.stdin) : undefined, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  const exitCode = await proc.exited;
  return { stdout, stderr, exitCode };
}

export function makeGhRunner(deps: { cwd: string; spawn?: SpawnFn }): GhRunner {
  const spawn = deps.spawn ?? defaultSpawn;
  const cwd = deps.cwd;

  return {
    async authStatus() {
      const r = await spawn(["gh", "auth", "status"], { cwd });
      return { ok: r.exitCode === 0, message: (r.stdout || r.stderr).trim() };
    },
    async listIssuesByLabel(label) {
      const r = await spawn(["gh", "issue", "list", "--label", label, "--state", "open",
        "--json", "number,title,body,labels", "--limit", "200"], { cwd });
      if (r.exitCode !== 0) throw new Error(`gh issue list failed: ${r.stderr}`);
      const raw = JSON.parse(r.stdout) as Array<{ number: number; title: string; body: string; labels: { name: string }[] }>;
      return raw.map(x => ({ number: x.number, title: x.title, body: x.body, labels: x.labels.map(l => l.name) }));
    },
    async getIssue(n) {
      const r = await spawn(["gh", "issue", "view", String(n), "--json", "number,title,body,labels"], { cwd });
      if (r.exitCode !== 0) throw new Error(`gh issue view ${n} failed: ${r.stderr}`);
      const raw = JSON.parse(r.stdout) as { number: number; title: string; body: string; labels: { name: string }[] };
      return { number: raw.number, title: raw.title, body: raw.body, labels: raw.labels.map(l => l.name) };
    },
    async commentIssue(n, body) {
      const r = await spawn(["gh", "issue", "comment", String(n), "--body", body], { cwd });
      if (r.exitCode !== 0) throw new Error(`gh issue comment ${n} failed: ${r.stderr}`);
    },
    async createPr(opts) {
      const cmd = ["gh", "pr", "create", "--title", opts.title, "--body", opts.body, "--head", opts.head, "--base", opts.base];
      if (opts.draft) cmd.push("--draft");
      const r = await spawn(cmd, { cwd });
      if (r.exitCode !== 0) throw new Error(`gh pr create failed: ${r.stderr}`);
      const url = r.stdout.trim().split("\n").pop() ?? "";
      const m = url.match(/\/pull\/(\d+)$/);
      const number = m ? parseInt(m[1]!, 10) : -1;
      return { number, url };
    },
    async mergePrSquashAuto(n) {
      const r = await spawn(["gh", "pr", "merge", String(n), "--squash", "--auto"], { cwd });
      return { ok: r.exitCode === 0, message: (r.stdout || r.stderr).trim() };
    },
  };
}
