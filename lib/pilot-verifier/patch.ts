import { REFERENCE_PATH } from "../pilot-types.ts";
import { getReferenceSource, MAX_PATCH_BYTES } from "./reference.ts";

type Hunk = { oldStart: number; oldCount: number; newStart: number; newCount: number; lines: string[] };
type ParsedPatch = { path: string; hunks: Hunk[] };

function safePath(path: string, directory = false): string {
  if (typeof path !== "string" || path.length > 240) throw new Error("Invalid patch path");
  const value = directory && path.endsWith("/") ? path.slice(0, -1) : path;
  const parts = value.split("/");
  if (!value || parts.some((part) => !/^[A-Za-z0-9_.-]+$/.test(part) || part.startsWith(".") || part === "..")) {
    throw new Error("Patch paths must be canonical relative paths without traversal or hidden entries");
  }
  if (parts.some((part) => /^(?:tests?|__tests__|configs?|scripts?|node_modules|vendor|fixtures|artifacts|out|cache)$/i.test(part))
    || /(?:^|[./_-])(?:test|spec|config)(?:[./_-]|$)/i.test(value)
    || /\.t\.sol$/i.test(value)) {
    throw new Error("Tests, configurations and protected paths cannot be patched");
  }
  return value;
}

function number(value: string): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0 || result > 100_000) throw new Error("Hunk coordinates exceed their bounds");
  return result;
}

export function parsePatch(patch: string, scopePaths: string[]): ParsedPatch {
  if (typeof patch !== "string" || !patch || Buffer.byteLength(patch, "utf8") > MAX_PATCH_BYTES) {
    throw new Error("A nonempty unified patch of at most 100KB is required");
  }
  if (Buffer.from(patch, "utf8").toString("utf8") !== patch || /[\u0000-\u0008\u000b-\u001f\u007f]/.test(patch)) {
    throw new Error("Patch must be valid UTF-8 text with LF line endings and no control characters");
  }
  if (!Array.isArray(scopePaths) || scopePaths.length === 0 || scopePaths.length > 50) throw new Error("Declared patch scope is required");
  const scopes = scopePaths.map((scope) => ({ path: safePath(scope, true), directory: scope.endsWith("/") }));
  const lines = patch.split("\n");
  if (lines.at(-1) === "") lines.pop();
  let cursor = 0;
  let gitPaths: string[] | undefined;
  if (lines[cursor]?.startsWith("diff --git ")) {
    const match = /^diff --git a\/([^\s]+) b\/([^\s]+)$/.exec(lines[cursor++]);
    if (!match) throw new Error("Malformed git diff header");
    gitPaths = [match[1], match[2]];
    if (/^index [0-9a-f]{7,40}\.\.[0-9a-f]{7,40}(?: 100644)?$/.test(lines[cursor] ?? "")) cursor++;
  }
  const oldPath = /^--- a\/([^\s]+)$/.exec(lines[cursor++] ?? "")?.[1];
  const newPath = /^\+\+\+ b\/([^\s]+)$/.exec(lines[cursor++] ?? "")?.[1];
  if (!oldPath || oldPath !== newPath || gitPaths?.some((path) => path !== oldPath)) {
    throw new Error("Only one existing file with matching canonical a/ and b/ headers can be edited");
  }
  const path = safePath(oldPath);
  if (!/\.sol$/.test(path)) throw new Error("Only Solidity source files may be patched");
  if (!scopes.some((scope) => scope.directory ? path.startsWith(`${scope.path}/`) : path === scope.path)) {
    throw new Error("The changed source path is outside the declared scope");
  }
  const hunks: Hunk[] = [];
  let lastOldEnd = 0;
  let delta = 0;
  let changes = 0;
  while (cursor < lines.length) {
    const header = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?: [^\r\n]*)?$/.exec(lines[cursor++]);
    if (!header || hunks.length >= 100) throw new Error("Malformed, multiple-file or unsupported diff metadata");
    const hunk: Hunk = {
      oldStart: number(header[1]), oldCount: number(header[2] ?? "1"),
      newStart: number(header[3]), newCount: number(header[4] ?? "1"), lines: []
    };
    const oldIndex = hunk.oldCount === 0 ? hunk.oldStart : hunk.oldStart - 1;
    const newIndex = hunk.newCount === 0 ? hunk.newStart : hunk.newStart - 1;
    if (oldIndex < lastOldEnd || oldIndex < 0 || newIndex !== oldIndex + delta || (!hunk.oldCount && !hunk.newCount)) {
      throw new Error("Hunks must be ordered, nonoverlapping and have consistent line coordinates");
    }
    let oldLines = 0;
    let newLines = 0;
    while (cursor < lines.length && !lines[cursor].startsWith("@@ ")) {
      const line = lines[cursor++];
      if (!/^[ +\-]/.test(line) || line.startsWith("--- ") || line.startsWith("+++ ")) {
        throw new Error("Only ordinary text hunk lines are allowed; metadata and file operations are rejected");
      }
      if (line[0] !== "+") oldLines++;
      if (line[0] !== "-") newLines++;
      if (line[0] !== " ") changes++;
      if (oldLines > hunk.oldCount || newLines > hunk.newCount) throw new Error("Hunk line counts do not match their header");
      hunk.lines.push(line);
    }
    if (oldLines !== hunk.oldCount || newLines !== hunk.newCount) throw new Error("Truncated hunk or incorrect line counts");
    lastOldEnd = oldIndex + hunk.oldCount;
    delta += hunk.newCount - hunk.oldCount;
    hunks.push(hunk);
  }
  if (!hunks.length || !changes) throw new Error("Patch must contain an actual edit");
  return { path, hunks };
}

function applyParsed(source: string, parsed: ParsedPatch): string {
  const original = source.split("\n");
  if (original.at(-1) === "") original.pop();
  const output: string[] = [];
  let cursor = 0;
  for (const hunk of parsed.hunks) {
    const start = hunk.oldCount === 0 ? hunk.oldStart : hunk.oldStart - 1;
    if (start > original.length || start + hunk.oldCount > original.length) throw new Error("Hunk lies outside the pinned source");
    output.push(...original.slice(cursor, start));
    cursor = start;
    for (const line of hunk.lines) {
      if (line[0] !== "+") {
        if (original[cursor] !== line.slice(1)) throw new Error("Hunk context or removal does not match the pinned fixture");
        cursor++;
      }
      if (line[0] !== "-") output.push(line.slice(1));
    }
  }
  output.push(...original.slice(cursor));
  const result = `${output.join("\n")}\n`;
  if (Buffer.byteLength(result, "utf8") > MAX_PATCH_BYTES) throw new Error("Patched source exceeds 100KB");
  return result;
}

function validateReferenceBody(source: string, candidate: string): void {
  const lines = source.split("\n");
  const prefix = `${lines.slice(0, 6).join("\n")}\n`;
  const suffix = `${lines.slice(9).join("\n")}`;
  if (!candidate.startsWith(prefix) || !candidate.endsWith(suffix)) {
    throw new Error("Reference edits must retain the pragma, contract, pure ABI, input bound and closing structure");
  }
  const body = candidate.slice(prefix.length, candidate.length - suffix.length);
  let tokens = "";
  let cursor = 0;
  while (cursor < body.length) {
    if (body.startsWith("//", cursor)) {
      const end = body.indexOf("\n", cursor);
      if (end < 0) throw new Error("Reference body cannot comment out the immutable closing structure");
      cursor = end;
    } else if (body.startsWith("/*", cursor)) {
      const end = body.indexOf("*/", cursor + 2);
      if (end < 0) throw new Error("Unterminated block comment in reference body");
      cursor = end + 2;
      tokens += " ";
    } else if (body[cursor] === '"' || body[cursor] === "'") {
      const quote = body[cursor++];
      let closed = false;
      while (cursor < body.length) {
        const character = body[cursor++];
        if (character === "\\") cursor++;
        else if (character === quote) { closed = true; break; }
      }
      if (!closed) throw new Error("Unterminated string in reference body");
      tokens += " ";
    } else tokens += body[cursor++];
  }
  if (/\b(?:import|pragma|contract|interface|library|function|modifier)\b/.test(tokens)) {
    throw new Error("Reference patches may only change the existing sum function loop body");
  }
  let braces = 0;
  for (const character of tokens) {
    if (character === "{") braces++;
    else if (character === "}") braces--;
    if (braces < 0) throw new Error("Reference edit escapes the sum function body");
  }
  if (braces !== 0) throw new Error("Reference body braces do not balance");
}

export function applyReferencePatch(patch: string): { baseline: string; candidate: string } {
  const parsed = parsePatch(patch, [REFERENCE_PATH]);
  if (parsed.path !== REFERENCE_PATH) throw new Error("Only the bundled reference source is locally executable");
  const baseline = getReferenceSource();
  const candidate = applyParsed(baseline, parsed);
  validateReferenceBody(baseline, candidate);
  return { baseline, candidate };
}

/** Structural validation for external artifacts; exact source-hunk matching for the pinned reference. */
export function validatePatch(patch: string, scopePaths: string[]): string[] {
  const parsed = parsePatch(patch, scopePaths);
  if (parsed.path === REFERENCE_PATH) applyReferencePatch(patch);
  return [parsed.path];
}
