import { test, expect } from "bun:test";
import { parseFinalJson } from "../src/parse";
import { claudeOutputWith, FINAL_JSON_READY, FINAL_JSON_REVIEW_BLOCKED } from "./fakes/fixtures";

test("parses a single ```json block at end of stdout", () => {
  const r = parseFinalJson(claudeOutputWith(FINAL_JSON_READY));
  expect(r).toEqual(FINAL_JSON_READY);
});

test("returns the LAST ```json block when multiple appear", () => {
  const stdout = `\`\`\`json
{ "noise": true }
\`\`\`
some text
${claudeOutputWith(FINAL_JSON_REVIEW_BLOCKED)}`;
  const r = parseFinalJson(stdout);
  expect(r).toEqual(FINAL_JSON_REVIEW_BLOCKED);
});

test("returns null on missing block", () => {
  expect(parseFinalJson("just text, no json")).toBeNull();
});

test("returns null on malformed JSON inside block", () => {
  expect(parseFinalJson("```json\n{ broken,\n```")).toBeNull();
});

test("returns null when JSON parses but schema is invalid", () => {
  const stdout = '```json\n{ "status": "weird" }\n```';
  expect(parseFinalJson(stdout)).toBeNull();
});

test("review_findings defaults to empty array if absent and otherwise valid", () => {
  const stdout = `\`\`\`json
{
  "status": "ready_to_merge",
  "branch": "nightcape/issue-12",
  "lint_passed": true,
  "build_passed": true,
  "summary": "ok"
}
\`\`\``;
  const r = parseFinalJson(stdout);
  expect(r?.review_findings).toEqual([]);
});
