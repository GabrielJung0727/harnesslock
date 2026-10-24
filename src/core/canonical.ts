import { createHash } from "node:crypto";

/**
 * RFC 8785 (JSON Canonicalization Scheme) serializer.
 *
 * - Object members are sorted by their UTF-16 code units (the default `Array#sort` order).
 * - Numbers use the ECMAScript `Number#toString` form, which is what JCS mandates and what
 *   `JSON.stringify` produces for finite numbers.
 * - Strings use ECMAScript JSON escaping.
 * - `undefined`, functions and symbols are dropped from objects and become `null` in arrays,
 *   mirroring `JSON.stringify`.
 */
export function canonicalize(value: unknown): string {
  return serialize(value);
}

function serialize(value: unknown): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isFinite(value)) throw new TypeError(`Cannot canonicalize non-finite number ${value}`);
      return JSON.stringify(value);
    case "string":
      return JSON.stringify(value);
    case "bigint":
      throw new TypeError("Cannot canonicalize BigInt values");
    case "object": {
      const withJson = value as { toJSON?: () => unknown };
      if (typeof withJson.toJSON === "function") return serialize(withJson.toJSON());
      if (Array.isArray(value)) {
        return `[${value.map((item) => (isOmitted(item) ? "null" : serialize(item))).join(",")}]`;
      }
      const record = value as Record<string, unknown>;
      const keys = Object.keys(record)
        .filter((key) => !isOmitted(record[key]))
        .sort();
      return `{${keys.map((key) => `${JSON.stringify(key)}:${serialize(record[key])}`).join(",")}}`;
    }
    default:
      throw new TypeError(`Cannot canonicalize value of type ${typeof value}`);
  }
}

function isOmitted(value: unknown): boolean {
  return value === undefined || typeof value === "function" || typeof value === "symbol";
}

/** Returns a `sha256:<hex>` digest. */
export function sha256(data: string | Uint8Array): string {
  return `sha256:${createHash("sha256").update(data).digest("hex")}`;
}

/** Canonical JSON -> SHA-256 fingerprint. */
export function fingerprint(value: unknown): string {
  return sha256(canonicalize(value));
}

export function shortHash(hash: string, length = 8): string {
  return hash.replace(/^sha256:/, "").slice(0, length);
}

/**
 * Text normalization applied before hashing any text file: strips a UTF-8 BOM, converts CRLF/CR
 * to LF, trims trailing whitespace on every line and drops trailing blank lines.
 */
export function normalizeText(text: string): string {
  const lines = text
    .replace(/^﻿/, "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/, ""));
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines.join("\n");
}

export function hashText(text: string): string {
  return sha256(normalizeText(text));
}

/**
 * Canonical form for instruction documents (CLAUDE.md, AGENTS.md, rules): HTML comments are
 * removed, whitespace is normalized and runs of blank lines collapse to one.
 */
export function canonicalizeInstruction(text: string): string {
  const withoutComments = text.replace(/^﻿/, "").replace(/<!--[\s\S]*?-->/g, "");
  return normalizeText(withoutComments)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function hashInstruction(text: string): string {
  return sha256(canonicalizeInstruction(text));
}

/** Heuristic used by git and most editors: a NUL byte in the first 8 KiB marks binary content. */
export function isBinaryContent(buffer: Uint8Array): boolean {
  const limit = Math.min(buffer.length, 8000);
  for (let i = 0; i < limit; i++) {
    if (buffer[i] === 0) return true;
  }
  return false;
}

/** Hashes file contents: text is normalized (line endings, trailing whitespace), binary is hashed raw. */
export function hashFileContent(buffer: Buffer): string {
  if (isBinaryContent(buffer)) return sha256(buffer);
  return hashText(buffer.toString("utf8"));
}
