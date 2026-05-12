import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, scaffoldConfig, DEFAULT_CONFIG, type LoadResult } from "../src/config";

function tmp(): string {
  return mkdtempSync(join(tmpdir(), "nc-"));
}

test("loadConfig: missing file returns { ok: false, reason: 'missing' }", () => {
  const dir = tmp();
  const r = loadConfig(dir);
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.reason).toBe("missing");
  rmSync(dir, { recursive: true });
});

test("loadConfig: malformed JSON returns ok:false reason:'parse'", () => {
  const dir = tmp();
  // Fix: create the .nightcape directory before writing the file
  mkdirSync(join(dir, ".nightcape"), { recursive: true });
  writeFileSync(join(dir, ".nightcape", "config.json"), "{broken", { flag: "wx" });
  const r = loadConfig(dir);
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.reason).toBe("parse");
  rmSync(dir, { recursive: true });
});

test("loadConfig: missing required field returns ok:false reason:'invalid'", async () => {
  const dir = tmp();
  const ncDir = join(dir, ".nightcape");
  // Fix: await the Bun.write call to avoid race condition
  await Bun.write(join(ncDir, "config.json"), JSON.stringify({ label: "x" }));
  const r = loadConfig(dir);
  expect(r.ok).toBe(false);
  if (!r.ok) {
    expect(r.reason).toBe("invalid");
    expect(r.errors!.length).toBeGreaterThan(0);
  }
  rmSync(dir, { recursive: true });
});

test("loadConfig: valid file returns ok:true with parsed config", async () => {
  const dir = tmp();
  await Bun.write(join(dir, ".nightcape", "config.json"), JSON.stringify(DEFAULT_CONFIG));
  const r = loadConfig(dir);
  expect(r.ok).toBe(true);
  if (r.ok) expect(r.config).toEqual(DEFAULT_CONFIG);
  rmSync(dir, { recursive: true });
});

test("scaffoldConfig: writes defaults, idempotent (tops up missing fields only)", async () => {
  const dir = tmp();
  scaffoldConfig(dir);
  expect(existsSync(join(dir, ".nightcape", "config.json"))).toBe(true);
  // Hand-edit one field, scaffold again, ensure custom value preserved
  const path = join(dir, ".nightcape", "config.json");
  const existing = JSON.parse(readFileSync(path, "utf8"));
  existing.label = "custom";
  await Bun.write(path, JSON.stringify(existing));
  scaffoldConfig(dir);
  const after = JSON.parse(readFileSync(path, "utf8"));
  expect(after.label).toBe("custom");
  expect(after.default_model).toBe(DEFAULT_CONFIG.default_model);
  rmSync(dir, { recursive: true });
});
