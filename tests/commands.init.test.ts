import { test, expect } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInit } from "../src/commands/init";

const tmp = () => mkdtempSync(join(tmpdir(), "nc-"));

test("init scaffolds .nightcape/config.json with defaults", async () => {
  const dir = tmp();
  const r = await runInit({ repoRoot: dir });
  expect(r.exitCode).toBe(0);
  expect(existsSync(join(dir, ".nightcape", "config.json"))).toBe(true);
  rmSync(dir, { recursive: true });
});

test("init adds .nightcape/ to .gitignore (creating .gitignore if absent)", async () => {
  const dir = tmp();
  await runInit({ repoRoot: dir });
  const gi = readFileSync(join(dir, ".gitignore"), "utf8");
  expect(gi).toContain(".nightcape/");
  rmSync(dir, { recursive: true });
});

test("init does not duplicate .nightcape/ entry on re-run", async () => {
  const dir = tmp();
  writeFileSync(join(dir, ".gitignore"), "node_modules/\n.nightcape/\n");
  await runInit({ repoRoot: dir });
  const gi = readFileSync(join(dir, ".gitignore"), "utf8");
  expect(gi.split("\n").filter(l => l.trim() === ".nightcape/")).toHaveLength(1);
  rmSync(dir, { recursive: true });
});
