import { promises as fs, type Dirent, type Stats } from "node:fs";
import path from "node:path";

export async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.lstat(p);
    return true;
  } catch {
    return false;
  }
}

export async function safeStat(p: string): Promise<Stats | undefined> {
  try {
    return await fs.stat(p);
  } catch {
    return undefined;
  }
}

export async function isDirectory(p: string): Promise<boolean> {
  return (await safeStat(p))?.isDirectory() ?? false;
}

export async function isFile(p: string): Promise<boolean> {
  return (await safeStat(p))?.isFile() ?? false;
}

export async function readTextIfExists(p: string): Promise<string | undefined> {
  try {
    return await fs.readFile(p, "utf8");
  } catch {
    return undefined;
  }
}

export async function readBufferIfExists(p: string, maxBytes = 16 * 1024 * 1024): Promise<Buffer | undefined> {
  try {
    const stat = await fs.stat(p);
    if (!stat.isFile() || stat.size > maxBytes) return undefined;
    return await fs.readFile(p);
  } catch {
    return undefined;
  }
}

export async function listDir(dir: string): Promise<Dirent[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  } catch {
    return [];
  }
}

export type ParseOutcome<T> = { ok: true; value: T; text: string } | { ok: false; error: string; text: string };

/** Removes `//` and `/* *\/` comments outside strings (JSONC, as used by Cursor/VS Code). */
function stripJsonComments(text: string): string {
  let out = "";
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (inString) {
      out += ch;
      if (ch === "\\") {
        out += next ?? "";
        i++;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
    } else if (ch === "/" && next === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
    } else if (ch === "/" && next === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i++;
    } else {
      out += ch;
    }
  }
  return out;
}

/** Removes trailing commas before `}` / `]` outside strings. */
function stripTrailingCommas(text: string): string {
  let out = "";
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      out += ch;
      if (ch === "\\") {
        out += text[i + 1] ?? "";
        i++;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }
    if (ch === ",") {
      let j = i + 1;
      while (j < text.length && /\s/.test(text[j] ?? "")) j++;
      if (text[j] === "}" || text[j] === "]") continue;
    }
    out += ch;
  }
  return out;
}

/** Strict JSON first, then JSONC (comments + trailing commas). */
export function parseJsonLoose(text: string): unknown {
  const clean = text.replace(/^﻿/, "");
  try {
    return JSON.parse(clean);
  } catch (strictError) {
    try {
      return JSON.parse(stripTrailingCommas(stripJsonComments(clean)));
    } catch {
      throw strictError;
    }
  }
}

/** Returns undefined when the file does not exist. */
export async function readJsonFile(p: string): Promise<ParseOutcome<unknown> | undefined> {
  const text = await readTextIfExists(p);
  if (text === undefined) return undefined;
  if (text.trim() === "") return { ok: true, value: {}, text };
  try {
    return { ok: true, value: parseJsonLoose(text), text };
  } catch (error) {
    return { ok: false, error: (error as Error).message, text };
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function toPosix(p: string): string {
  return p.replace(/\\/g, "/");
}

export function relPosix(root: string, abs: string): string {
  return toPosix(path.relative(root, abs));
}

export function isInside(root: string, target: string): boolean {
  const rel = path.relative(path.resolve(root), path.resolve(target));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/** Displays home-relative paths as `~/...` so reports never leak usernames. */
export function homeDisplay(abs: string, homeDir: string): string {
  if (isInside(homeDir, abs)) {
    const rel = relPosix(homeDir, abs);
    return rel === "" ? "~" : `~/${rel}`;
  }
  return toPosix(abs);
}

export interface WalkOptions {
  ignoreDirs?: ReadonlySet<string>;
  maxFiles?: number;
  maxDepth?: number;
}

const DEFAULT_IGNORED_DIRS: ReadonlySet<string> = new Set([".git", "node_modules", ".DS_Store"]);

/** Recursively lists files (absolute paths, sorted). Symlinked directories are not followed. */
export async function walkFiles(dir: string, options: WalkOptions = {}): Promise<string[]> {
  const ignore = options.ignoreDirs ?? DEFAULT_IGNORED_DIRS;
  const maxFiles = options.maxFiles ?? 10_000;
  const maxDepth = options.maxDepth ?? 16;
  const files: string[] = [];

  async function visit(current: string, depth: number): Promise<void> {
    if (files.length >= maxFiles || depth > maxDepth) return;
    for (const entry of await listDir(current)) {
      if (files.length >= maxFiles) return;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!ignore.has(entry.name)) await visit(full, depth + 1);
      } else if (entry.isFile()) {
        files.push(full);
      } else if (entry.isSymbolicLink()) {
        const stat = await safeStat(full);
        if (stat?.isFile()) files.push(full);
      }
    }
  }

  await visit(dir, 0);
  return files.sort();
}

export function detectIndent(text: string): string | number {
  const match = /^([ \t]+)\S/m.exec(text);
  if (!match?.[1]) return 2;
  return match[1].startsWith("\t") ? "\t" : match[1].length;
}

export function detectEol(text: string): "\n" | "\r\n" {
  return text.includes("\r\n") ? "\r\n" : "\n";
}

/** Writes JSON keeping the original indentation, line endings and trailing newline. */
export function formatJsonLike(original: string, value: unknown): string {
  const eol = detectEol(original);
  let out = JSON.stringify(value, null, detectIndent(original));
  if (eol === "\r\n") out = out.replace(/\n/g, "\r\n");
  if (/\r?\n$/.test(original) || original === "") out += eol;
  return out;
}

export function uniqueSorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort();
}
