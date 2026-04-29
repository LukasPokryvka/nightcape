import { test, expect } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  initState, loadState, saveState, markInProgress,
  recordCompletion, setRateLimit, archiveState,
} from "../src/state";
import type { State } from "../src/types";

const tmp = () => mkdtempSync(join(tmpdir(), "nc-"));

test("loadState: missing returns null", () => {
  const dir = tmp();
  expect(loadState(dir)).toBeNull();
  rmSync(dir, { recursive: true });
});

test("initState writes a fresh state with queue snapshot", () => {
  const dir = tmp();
  const s = initState(dir, [12, 13, 14]);
  expect(s.queue_snapshot).toEqual([12, 13, 14]);
  expect(s.in_progress).toBeNull();
  expect(s.completed).toEqual([]);
  expect(s.rate_limit_until).toBeNull();
  expect(existsSync(join(dir, ".nightcape", "state.json"))).toBe(true);
  rmSync(dir, { recursive: true });
});

test("markInProgress + recordCompletion round-trip via saveState/loadState", () => {
  const dir = tmp();
  let s = initState(dir, [12, 13]);
  s = markInProgress(s, 12);
  saveState(dir, s);
  s = loadState(dir)!;
  expect(s.in_progress).toBe(12);

  s = recordCompletion(s, {
    issue: 12, outcome: "auto_merged", branch: "nightcape/issue-12",
    pr: 47, duration_sec: 612, model: "sonnet",
  });
  saveState(dir, s);
  s = loadState(dir)!;
  expect(s.in_progress).toBeNull();
  expect(s.completed).toHaveLength(1);
  expect(s.completed[0]!.issue).toBe(12);
  rmSync(dir, { recursive: true });
});

test("setRateLimit stores ISO timestamp", () => {
  const dir = tmp();
  let s = initState(dir, [12]);
  s = setRateLimit(s, "2026-04-30T03:00:00Z");
  expect(s.rate_limit_until).toBe("2026-04-30T03:00:00Z");
  rmSync(dir, { recursive: true });
});

test("saveState writes atomically (temp + rename)", () => {
  const dir = tmp();
  const s: State = {
    version: 1, run_id: "r1", started_at: new Date().toISOString(),
    queue_snapshot: [1], in_progress: null, completed: [], rate_limit_until: null,
  };
  saveState(dir, s);
  // No temp file should remain
  expect(existsSync(join(dir, ".nightcape", "state.json.tmp"))).toBe(false);
  expect(existsSync(join(dir, ".nightcape", "state.json"))).toBe(true);
  rmSync(dir, { recursive: true });
});

test("archiveState moves state.json into runs/<date>/", () => {
  const dir = tmp();
  initState(dir, [1]);
  archiveState(dir, "2026-04-29");
  expect(existsSync(join(dir, ".nightcape", "state.json"))).toBe(false);
  expect(existsSync(join(dir, ".nightcape", "runs", "2026-04-29", "state.json"))).toBe(true);
  rmSync(dir, { recursive: true });
});
