import { test, expect } from "bun:test";
import { runCli } from "../src/cli";

test("runCli with no args prints help and exits 0", async () => {
  const result = await runCli([]);
  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain("nightcape");
  expect(result.stdout).toContain("help");
  expect(result.stdout).toContain("doctor");
  expect(result.stdout).toContain("start");
});

test("runCli with --help prints help", async () => {
  const result = await runCli(["--help"]);
  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain("nightcape");
});

test("runCli with unknown command exits 1 with hint", async () => {
  const result = await runCli(["bogus"]);
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("unknown command");
});
