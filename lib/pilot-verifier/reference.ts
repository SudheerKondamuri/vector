import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { REFERENCE_COMMIT, REFERENCE_PATH } from "../pilot-types.ts";

export const MAX_PATCH_BYTES = 100_000;
export const REFERENCE_SOURCE_SHA256 = "ebfd7c3bdd5c3d7456a97f667c90d16e8e3f025a3b5b217f77d2284f5c3fdfc5";
const EXAMPLE_PATCH_SHA256 = "0b4ed02817cfbcd02b098c2927f8f0a6a567ab18176e042525f307c0e8afd352";

export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function projectPath(...parts: string[]): string {
  return resolve(process.cwd(), ...parts);
}

function readPinned(relativePath: string, expectedHash: string): string {
  const path = projectPath("fixtures", "reference", relativePath);
  if (!statSync(path).isFile() || statSync(path).size > MAX_PATCH_BYTES) {
    throw new Error("The bundled reference fixture is missing or exceeds its size bound");
  }
  const text = readFileSync(path, "utf8");
  if (sha256(text) !== expectedHash) throw new Error("The bundled reference fixture hash does not match its pinned source");
  return text;
}

export function getReferenceSource(): string {
  return readPinned(REFERENCE_PATH, REFERENCE_SOURCE_SHA256);
}

export function getReferenceBundle(): { source: string; patch: string; commit: string; path: string } {
  return {
    source: getReferenceSource(), patch: readPinned("optimized.patch", EXAMPLE_PATCH_SHA256),
    commit: REFERENCE_COMMIT, path: REFERENCE_PATH
  };
}
