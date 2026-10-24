import { promises as fs } from "node:fs";
import path from "node:path";
import type { ResolvedConfig, ResolvedSyncGroup } from "../schema/config-schema.js";
import type {
  InstructionEvaluation,
  InstructionFileState,
  InstructionGroupResult,
  InstructionStrategy,
} from "../types/model.js";
import { canonicalizeInstruction, sha256 } from "./canonical.js";
import { isFile, isInside, readTextIfExists, toPosix, uniqueSorted } from "./fs-utils.js";
import { gitFileStates } from "./git-index.js";

/**
 * Cross-agent instruction synchronization (CLAUDE.md <-> AGENTS.md <-> ...).
 *
 * Files are compared by their canonical form (HTML comments removed, whitespace normalized), and
 * Claude-style `@path` import lines are expanded so a `CLAUDE.md` containing only `@AGENTS.md`
 * counts as synced with `AGENTS.md`.
 */

const MAX_IMPORT_DEPTH = 5;

async function expandImports(content: string, fileAbs: string, root: string, depth: number, seen: Set<string>): Promise<string> {
  if (depth >= MAX_IMPORT_DEPTH) return content;
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  for (const line of lines) {
    const match = /^\s*@([^\s@][^\s]*)\s*$/.exec(line);
    if (match?.[1] && !match[1].startsWith("~")) {
      const target = path.resolve(path.dirname(fileAbs), match[1]);
      if (isInside(root, target) && !seen.has(target) && (await isFile(target))) {
        const inner = await readTextIfExists(target);
        if (inner !== undefined) {
          const nextSeen = new Set(seen).add(target);
          out.push(await expandImports(inner, target, root, depth + 1, nextSeen));
          continue;
        }
      }
    }
    out.push(line);
  }
  return out.join("\n");
}

export interface InstructionRead extends InstructionFileState {
  raw?: string;
  canonical?: string;
}

export async function readInstruction(root: string, relPath: string): Promise<InstructionRead> {
  const abs = path.join(root, relPath);
  let symlinkTarget: string | undefined;
  let mtimeMs: number | undefined;
  try {
    const lstat = await fs.lstat(abs);
    if (lstat.isSymbolicLink()) symlinkTarget = toPosix(await fs.readlink(abs));
    mtimeMs = (await fs.stat(abs)).mtimeMs;
  } catch {
    return { path: relPath, exists: false };
  }
  const raw = await readTextIfExists(abs);
  if (raw === undefined) return { path: relPath, exists: false };
  const expanded = await expandImports(raw, abs, root, 0, new Set([abs]));
  const canonical = canonicalizeInstruction(expanded);
  return { path: relPath, exists: true, raw, canonical, hash: sha256(canonical), mtimeMs, symlinkTarget };
}

function stripContent(read: InstructionRead): InstructionFileState {
  const { raw: _raw, canonical: _canonical, ...state } = read;
  return state;
}

export async function evaluateSyncGroup(root: string, group: ResolvedSyncGroup): Promise<InstructionGroupResult> {
  const reads = await Promise.all(group.files.map((file) => readInstruction(root, file)));
  const existing = reads.filter((r) => r.exists);
  const files = reads.map(stripContent);
  const base = { name: group.name, enforceIdentical: group.enforceIdentical, files };

  if (existing.length === 0) {
    return { ...base, status: "missing", message: `none of ${group.files.join(", ")} exist` };
  }
  const first = existing[0] as InstructionRead;
  if (existing.length === 1) {
    return {
      ...base,
      status: "partial",
      canonicalFingerprint: first.hash,
      message: `only ${first.path} present`,
    };
  }
  const hashes = new Set(existing.map((r) => r.hash));
  if (hashes.size === 1) {
    return {
      ...base,
      status: "synced",
      canonicalFingerprint: first.hash,
      message: `${existing.map((r) => r.path).join(" == ")} (synced)`,
    };
  }
  const newest = [...existing].sort((a, b) => (b.mtimeMs ?? 0) - (a.mtimeMs ?? 0))[0] as InstructionRead;
  const differing = existing.filter((r) => r.hash !== first.hash).map((r) => r.path);
  return {
    ...base,
    status: "desynced",
    canonicalFingerprint: first.hash,
    newestFile: newest.path,
    message: `${first.path} != ${differing.join(", ")} (${newest.path} is newer)`,
  };
}

/** Every instruction file tracked by the configuration (sync group members + extra files). */
export function trackedInstructionFiles(config: ResolvedConfig): string[] {
  return uniqueSorted([...config.instructions.syncGroups.flatMap((g) => g.files), ...config.instructions.files]);
}

export async function evaluateInstructions(root: string, config: ResolvedConfig): Promise<InstructionEvaluation> {
  const strategy: InstructionStrategy = config.instructions.strategy;
  const groups = await Promise.all(config.instructions.syncGroups.map((group) => evaluateSyncGroup(root, group)));
  const tracked = trackedInstructionFiles(config);

  const fileHashes: Record<string, string | undefined> = {};
  if (strategy === "strict-hash") {
    for (const file of tracked) fileHashes[file] = (await readInstruction(root, file)).hash;
  }
  const gitStatus = strategy === "git-clean" ? await gitFileStates(root, tracked) : {};
  return { strategy, groups, fileHashes, gitStatus };
}

export interface InstructionSyncAction {
  group: string;
  source: string;
  target: string;
}

/**
 * Copies the canonical source (first existing file of the group) over every existing member whose
 * canonical content differs. Missing members are not created.
 */
export async function syncInstructionGroup(root: string, group: ResolvedSyncGroup, dryRun = false): Promise<InstructionSyncAction[]> {
  const reads = await Promise.all(group.files.map((file) => readInstruction(root, file)));
  const existing = reads.filter((r) => r.exists);
  const source = existing[0];
  if (!source || source.raw === undefined) return [];
  const actions: InstructionSyncAction[] = [];
  for (const target of existing.slice(1)) {
    if (target.hash === source.hash) continue;
    actions.push({ group: group.name, source: source.path, target: target.path });
    if (!dryRun) await fs.writeFile(path.join(root, target.path), source.raw, "utf8");
  }
  return actions;
}
