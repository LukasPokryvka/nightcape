import type { Issue } from "../types";

export type GhRunner = {
  authStatus(): Promise<{ ok: boolean; message: string }>;
  listIssuesByLabel(label: string): Promise<Issue[]>;
  getIssue(n: number): Promise<Issue>;
  commentIssue(n: number, body: string): Promise<void>;
  createPr(opts: {
    title: string;
    body: string;
    head: string;
    base: string;
    draft: boolean;
  }): Promise<{ number: number; url: string }>;
  mergePrSquashAuto(n: number): Promise<{ ok: boolean; message: string }>;
};

export type GitRunner = {
  isRepo(): Promise<boolean>;
  hasRemote(): Promise<boolean>;
  fetch(remote: string): Promise<void>;
  revParse(ref: string): Promise<string>;
  branchExists(name: string): Promise<boolean>;
};

export type ClaudeRunResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationSec: number;
  rateLimited: boolean;
  rateLimitUntil: string | null; // ISO if parseable
};

export type ClaudeRunner = {
  version(): Promise<string>;
  hasSuperpowers(): Promise<boolean>;
  run(opts: {
    prompt: string;
    model: "sonnet" | "opus";
    permissionMode: "dangerous" | "acceptEdits" | "default";
    cwd: string;
    logPath: string;             // stream stdout here line-by-line
    onSignalCheck?: () => "stop" | null; // poll for graceful stop
  }): Promise<ClaudeRunResult>;
};
