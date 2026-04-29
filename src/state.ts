import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { State, CompletedEntry } from "./types";

const STATE_REL = ".nightcape/state.json";

function statePath(repoRoot: string): string {
  return join(repoRoot, STATE_REL);
}

function ensureDir(p: string): void {
  if (!existsSync(p)) mkdirSync(p, { recursive: true });
}

export function loadState(repoRoot: string): State | null {
  const path = statePath(repoRoot);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as State;
}

export function saveState(repoRoot: string, state: State): void {
  const path = statePath(repoRoot);
  ensureDir(dirname(path));
  const tmp = path + ".tmp";
  writeFileSync(tmp, JSON.stringify(state, null, 2) + "\n");
  renameSync(tmp, path);
}

export function initState(repoRoot: string, queue: number[]): State {
  const now = new Date();
  const runId = now.toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const state: State = {
    version: 1,
    run_id: runId,
    started_at: now.toISOString(),
    queue_snapshot: [...queue],
    in_progress: null,
    completed: [],
    rate_limit_until: null,
  };
  saveState(repoRoot, state);
  return state;
}

export function markInProgress(state: State, issue: number | null): State {
  return { ...state, in_progress: issue };
}

export function recordCompletion(state: State, entry: CompletedEntry): State {
  return {
    ...state,
    in_progress: null,
    completed: [...state.completed, entry],
  };
}

export function setRateLimit(state: State, untilIso: string | null): State {
  return { ...state, rate_limit_until: untilIso };
}

export function archiveState(repoRoot: string, dateLabel: string): void {
  const src = statePath(repoRoot);
  if (!existsSync(src)) return;
  const dstDir = join(repoRoot, ".nightcape", "runs", dateLabel);
  ensureDir(dstDir);
  renameSync(src, join(dstDir, "state.json"));
}
