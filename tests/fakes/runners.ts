import type { GhRunner, GitRunner, ClaudeRunner, ClaudeRunResult } from "../../src/runners/types";
import type { Issue } from "../../src/types";

type Recorded = { method: string; args: unknown[] };

export class FakeGh implements GhRunner {
  calls: Recorded[] = [];
  authOk = true;
  issues: Issue[] = [];
  prCounter = 100;
  prMergeAcceptedFor: Set<number> = new Set();

  async authStatus() {
    this.calls.push({ method: "authStatus", args: [] });
    return { ok: this.authOk, message: this.authOk ? "ok" : "not authenticated" };
  }
  async listIssuesByLabel(label: string) {
    this.calls.push({ method: "listIssuesByLabel", args: [label] });
    return this.issues.filter(i => i.labels.includes(label));
  }
  async getIssue(n: number) {
    this.calls.push({ method: "getIssue", args: [n] });
    const i = this.issues.find(x => x.number === n);
    if (!i) throw new Error(`issue ${n} not found`);
    return i;
  }
  async commentIssue(n: number, body: string) {
    this.calls.push({ method: "commentIssue", args: [n, body] });
  }
  async createPr(opts: { title: string; body: string; head: string; base: string; draft: boolean }) {
    this.calls.push({ method: "createPr", args: [opts] });
    const number = this.prCounter++;
    return { number, url: `https://github.com/test/repo/pull/${number}` };
  }
  async mergePrSquashAuto(n: number) {
    this.calls.push({ method: "mergePrSquashAuto", args: [n] });
    if (this.prMergeAcceptedFor.has(n)) return { ok: true, message: "queued" };
    return { ok: false, message: "branch protection rejects merge" };
  }
}

export class FakeGit implements GitRunner {
  calls: Recorded[] = [];
  repoOk = true;
  remoteOk = true;
  branches = new Set<string>();
  refs: Record<string, string> = { HEAD: "deadbeef", "origin/main": "deadbeef" };

  async isRepo() { this.calls.push({ method: "isRepo", args: [] }); return this.repoOk; }
  async hasRemote() { this.calls.push({ method: "hasRemote", args: [] }); return this.remoteOk; }
  async fetch(remote: string) { this.calls.push({ method: "fetch", args: [remote] }); }
  async revParse(ref: string) {
    this.calls.push({ method: "revParse", args: [ref] });
    const sha = this.refs[ref];
    if (!sha) throw new Error(`unknown ref ${ref}`);
    return sha;
  }
  async branchExists(name: string) {
    this.calls.push({ method: "branchExists", args: [name] });
    return this.branches.has(name);
  }
}

export type ScriptedClaudeResponse = Partial<ClaudeRunResult> & { stdout: string };

export class FakeClaude implements ClaudeRunner {
  calls: Recorded[] = [];
  superpowersInstalled = true;
  versionString = "claude 1.0.0";
  responses: ScriptedClaudeResponse[] = [];

  async version() { this.calls.push({ method: "version", args: [] }); return this.versionString; }
  async hasSuperpowers() { this.calls.push({ method: "hasSuperpowers", args: [] }); return this.superpowersInstalled; }
  async run(opts: Parameters<ClaudeRunner["run"]>[0]): Promise<ClaudeRunResult> {
    this.calls.push({ method: "run", args: [opts] });
    const next = this.responses.shift();
    if (!next) throw new Error("FakeClaude: no scripted response remaining");
    return {
      stdout: next.stdout,
      stderr: next.stderr ?? "",
      exitCode: next.exitCode ?? 0,
      durationSec: next.durationSec ?? 1,
      rateLimited: next.rateLimited ?? false,
      rateLimitUntil: next.rateLimitUntil ?? null,
    };
  }
}
