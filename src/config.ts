import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Config, Severity } from "./types";

export const DEFAULT_CONFIG: Config = {
  label: "nightcape",
  default_model: "sonnet",
  permission_mode: "dangerous",
  lint: "bun run lint",
  build: "bun run build",
  worktrees_dir: "~/.nightcape/worktrees",
  max_issues_per_run: 20,
  blocking_severities: ["Critical", "Important"],
};

export type LoadResult =
  | { ok: true; config: Config }
  | { ok: false; reason: "missing" | "parse" | "invalid"; errors?: string[] };

const VALID_MODELS = new Set(["sonnet", "opus"]);
const VALID_PERMS = new Set(["dangerous", "acceptEdits", "default"]);
const VALID_SEVS = new Set<Severity>(["Critical", "Important", "Minor"]);

function validate(raw: unknown): { ok: true; config: Config } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!raw || typeof raw !== "object") return { ok: false, errors: ["config is not an object"] };
  const o = raw as Record<string, unknown>;

  const need = (key: keyof Config) => {
    if (!(key in o)) errors.push(`missing field: ${String(key)}`);
  };
  (["label", "default_model", "permission_mode", "lint", "build", "worktrees_dir", "max_issues_per_run", "blocking_severities"] as const).forEach(need);
  if (errors.length) return { ok: false, errors };

  if (typeof o.label !== "string") errors.push("label must be string");
  if (!VALID_MODELS.has(o.default_model as string)) errors.push("default_model must be 'sonnet'|'opus'");
  if (!VALID_PERMS.has(o.permission_mode as string)) errors.push("permission_mode must be 'dangerous'|'acceptEdits'|'default'");
  if (typeof o.lint !== "string") errors.push("lint must be string");
  if (typeof o.build !== "string") errors.push("build must be string");
  if (typeof o.worktrees_dir !== "string") errors.push("worktrees_dir must be string");
  if (typeof o.max_issues_per_run !== "number" || (o.max_issues_per_run as number) < 1) errors.push("max_issues_per_run must be a positive number");
  if (!Array.isArray(o.blocking_severities) || (o.blocking_severities as unknown[]).some(s => !VALID_SEVS.has(s as Severity))) {
    errors.push("blocking_severities must be an array of 'Critical'|'Important'|'Minor'");
  }
  if (errors.length) return { ok: false, errors };

  return { ok: true, config: o as unknown as Config };
}

export function loadConfig(repoRoot: string): LoadResult {
  const path = join(repoRoot, ".nightcape", "config.json");
  if (!existsSync(path)) return { ok: false, reason: "missing" };
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    return { ok: false, reason: "parse" };
  }
  const v = validate(raw);
  if (!v.ok) return { ok: false, reason: "invalid", errors: v.errors };
  return { ok: true, config: v.config };
}

export function scaffoldConfig(repoRoot: string): void {
  const ncDir = join(repoRoot, ".nightcape");
  if (!existsSync(ncDir)) mkdirSync(ncDir, { recursive: true });
  const path = join(ncDir, "config.json");
  let existing: Partial<Config> = {};
  if (existsSync(path)) {
    try { existing = JSON.parse(readFileSync(path, "utf8")); } catch { existing = {}; }
  }
  const merged: Config = { ...DEFAULT_CONFIG, ...existing };
  writeFileSync(path, JSON.stringify(merged, null, 2) + "\n");
}
