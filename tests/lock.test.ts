import { test, expect } from "bun:test";
import { mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireLock, releaseLock, isLockHeld } from "../src/lock";

const tmp = () => mkdtempSync(join(tmpdir(), "nc-"));

test("acquireLock writes PID and isLockHeld is true", () => {
  const dir = tmp();
  const r = acquireLock(dir, () => true);
  expect(r.acquired).toBe(true);
  expect(isLockHeld(dir, () => true)).toBe(true);
  rmSync(dir, { recursive: true });
});

test("acquireLock fails if a live PID already holds it", () => {
  const dir = tmp();
  mkdirSync(join(dir, ".nightcape"));
  writeFileSync(join(dir, ".nightcape", "run.lock"), "12345\n");
  const r = acquireLock(dir, () => true); // pretend pid 12345 is alive
  expect(r.acquired).toBe(false);
  expect((r as { acquired: false; heldByPid: number }).heldByPid).toBe(12345);
  rmSync(dir, { recursive: true });
});

test("acquireLock reaps stale lock (PID dead) with a warning", () => {
  const dir = tmp();
  mkdirSync(join(dir, ".nightcape"));
  writeFileSync(join(dir, ".nightcape", "run.lock"), "99999\n");
  const r = acquireLock(dir, () => false); // pid dead
  expect(r.acquired).toBe(true);
  expect((r as { acquired: true; reaped?: boolean }).reaped).toBe(true);
  rmSync(dir, { recursive: true });
});

test("releaseLock removes the lockfile", () => {
  const dir = tmp();
  acquireLock(dir, () => true);
  releaseLock(dir);
  expect(existsSync(join(dir, ".nightcape", "run.lock"))).toBe(false);
  rmSync(dir, { recursive: true });
});

test("isLockHeld returns false when file missing", () => {
  const dir = tmp();
  expect(isLockHeld(dir, () => true)).toBe(false);
  rmSync(dir, { recursive: true });
});
