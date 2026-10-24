import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { GitFileState } from "../types/model.js";
import { readBufferIfExists, readTextIfExists, safeStat, toPosix } from "./fs-utils.js";

/**
 * Static git inspection: locates the repository and parses `.git/index` directly (versions 2-4),
 * so `git-clean` checks never shell out to `git`.
 */

export interface GitRepo {
  gitDir: string;
  workTree: string;
}

export async function findGitRepo(start: string): Promise<GitRepo | undefined> {
  let current = path.resolve(start);
  for (;;) {
    const dotGit = path.join(current, ".git");
    const stat = await safeStat(dotGit);
    if (stat?.isDirectory()) return { gitDir: dotGit, workTree: current };
    if (stat?.isFile()) {
      const text = (await readTextIfExists(dotGit)) ?? "";
      const match = /^gitdir:\s*(.+)$/m.exec(text);
      if (match?.[1]) return { gitDir: path.resolve(current, match[1].trim()), workTree: current };
    }
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

/** Reads `core.hooksPath` from the repository config, if set. */
export async function readHooksPath(repo: GitRepo): Promise<string | undefined> {
  const commonDirText = await readTextIfExists(path.join(repo.gitDir, "commondir"));
  const commonDir = commonDirText ? path.resolve(repo.gitDir, commonDirText.trim()) : repo.gitDir;
  const config = await readTextIfExists(path.join(commonDir, "config"));
  if (!config) return undefined;
  let section = "";
  for (const rawLine of config.split(/\r?\n/)) {
    const line = rawLine.trim();
    const header = /^\[([^\]]+)\]$/.exec(line);
    if (header?.[1]) {
      section = header[1].trim().toLowerCase();
      continue;
    }
    if (section !== "core") continue;
    const kv = /^hookspath\s*=\s*(.+)$/i.exec(line);
    if (kv?.[1]) return path.resolve(repo.workTree, kv[1].trim().replace(/^"|"$/g, ""));
  }
  return undefined;
}

export async function resolveHooksDir(repo: GitRepo): Promise<string> {
  const configured = await readHooksPath(repo);
  if (configured) return configured;
  const commonDirText = await readTextIfExists(path.join(repo.gitDir, "commondir"));
  const commonDir = commonDirText ? path.resolve(repo.gitDir, commonDirText.trim()) : repo.gitDir;
  return path.join(commonDir, "hooks");
}

/** Parses the git index into `path -> blob sha1` for stage-0 entries. */
export function parseGitIndex(buffer: Buffer): Map<string, string> {
  const entries = new Map<string, string>();
  if (buffer.length < 12 || buffer.toString("ascii", 0, 4) !== "DIRC") {
    throw new Error("not a git index file (missing DIRC signature)");
  }
  const version = buffer.readUInt32BE(4);
  if (version < 2 || version > 4) throw new Error(`unsupported git index version ${version}`);
  const count = buffer.readUInt32BE(8);
  let offset = 12;
  let previousName = "";

  for (let i = 0; i < count; i++) {
    const entryStart = offset;
    if (offset + 62 > buffer.length) throw new Error("truncated git index entry");
    const sha = buffer.toString("hex", offset + 40, offset + 60);
    const flags = buffer.readUInt16BE(offset + 60);
    offset += 62;
    if (version >= 3 && flags & 0x4000) offset += 2;
    const stage = (flags >> 12) & 0x3;

    let name: string;
    if (version === 4) {
      let byte = buffer[offset++] ?? 0;
      let strip = byte & 0x7f;
      while (byte & 0x80) {
        strip += 1;
        byte = buffer[offset++] ?? 0;
        strip = (strip << 7) + (byte & 0x7f);
      }
      const end = buffer.indexOf(0, offset);
      if (end < 0) throw new Error("truncated git index path");
      name = previousName.slice(0, previousName.length - strip) + buffer.toString("utf8", offset, end);
      offset = end + 1;
    } else {
      const end = buffer.indexOf(0, offset);
      if (end < 0) throw new Error("truncated git index path");
      name = buffer.toString("utf8", offset, end);
      const entryLength = end - entryStart;
      offset = entryStart + Math.ceil((entryLength + 1) / 8) * 8;
    }
    previousName = name;
    if (stage === 0) entries.set(name, sha);
  }
  return entries;
}

export function gitBlobSha1(content: Buffer): string {
  return createHash("sha1").update(`blob ${content.length}\0`).update(content).digest("hex");
}

/** Compares working tree files against the index without invoking git. */
export async function gitFileStates(root: string, files: readonly string[]): Promise<Record<string, GitFileState>> {
  const result: Record<string, GitFileState> = {};
  const repo = await findGitRepo(root);
  if (!repo) {
    for (const file of files) result[file] = "no-repo";
    return result;
  }
  let index = new Map<string, string>();
  try {
    index = parseGitIndex(await fs.readFile(path.join(repo.gitDir, "index")));
  } catch {
    // A fresh repository without an index has no tracked files.
  }
  for (const file of files) {
    const abs = path.join(root, file);
    const content = await readBufferIfExists(abs);
    const key = toPosix(path.relative(repo.workTree, abs));
    const expected = index.get(key);
    if (content === undefined) {
      result[file] = expected ? "dirty" : "missing";
      continue;
    }
    if (!expected) {
      result[file] = "untracked";
      continue;
    }
    if (gitBlobSha1(content) === expected) {
      result[file] = "clean";
      continue;
    }
    // core.autocrlf checkouts store LF in the index but CRLF in the working tree.
    const lf = Buffer.from(content.toString("utf8").replace(/\r\n/g, "\n"), "utf8");
    result[file] = gitBlobSha1(lf) === expected ? "clean" : "dirty";
  }
  return result;
}
