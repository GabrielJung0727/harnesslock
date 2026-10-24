import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import pc from "picocolors";
import type { ScanContext } from "../adapters/index.js";
import { fingerprint } from "../core/canonical.js";
import { readTextIfExists } from "../core/fs-utils.js";
import { ConfigValidationError, parseConfigText, type ResolvedConfig } from "../schema/config-schema.js";
import { parseLockText, serializeLock, type HarnessLockFile } from "../schema/lock-schema.js";

export const CONFIG_FILES = ["harnesslock.yaml", "harnesslock.yml"] as const;
export const LOCK_FILE = "harnesslock.lock";

export interface CommandContext extends ScanContext {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  color: boolean;
}

export interface ContextOverrides {
  root?: string;
  homeDir?: string;
  env?: Record<string, string | undefined>;
  platform?: NodeJS.Platform;
  stdout?: (text: string) => void;
  stderr?: (text: string) => void;
  color?: boolean;
}

export function createContext(overrides: ContextOverrides = {}): CommandContext {
  const env = overrides.env ?? process.env;
  return {
    root: path.resolve(overrides.root ?? process.cwd()),
    homeDir: path.resolve(overrides.homeDir ?? env.HARNESSLOCK_HOME ?? os.homedir()),
    env,
    platform: overrides.platform ?? process.platform,
    stdout: overrides.stdout ?? ((text) => void process.stdout.write(text)),
    stderr: overrides.stderr ?? ((text) => void process.stderr.write(text)),
    color: overrides.color ?? (pc.isColorSupported && !env.NO_COLOR),
  };
}

/** Errors that map to a specific process exit code (2 = invalid configuration / internal error). */
export class HarnessLockError extends Error {
  constructor(
    message: string,
    readonly exitCode: number = 2,
  ) {
    super(message);
    this.name = "HarnessLockError";
  }
}

export interface Project {
  configPath: string;
  config: ResolvedConfig;
  raw: unknown;
  specHash: string;
  lockPath: string;
  lock?: HarnessLockFile;
}

export async function findConfigFile(root: string): Promise<string | undefined> {
  for (const name of CONFIG_FILES) {
    const abs = path.join(root, name);
    if ((await readTextIfExists(abs)) !== undefined) return abs;
  }
  return undefined;
}

export async function loadProject(ctx: CommandContext): Promise<Project> {
  const configPath = await findConfigFile(ctx.root);
  if (!configPath) {
    throw new HarnessLockError("harnesslock.yaml not found. Run `npx harnesslock init` to create one.", 2);
  }
  const text = (await readTextIfExists(configPath)) ?? "";
  let parsed;
  try {
    parsed = parseConfigText(text, path.basename(configPath));
  } catch (error) {
    if (error instanceof ConfigValidationError) throw new HarnessLockError(error.message, 2);
    throw error;
  }
  const lockPath = path.join(ctx.root, LOCK_FILE);
  const lockText = await readTextIfExists(lockPath);
  let lock: HarnessLockFile | undefined;
  if (lockText !== undefined) {
    try {
      lock = parseLockText(lockText, LOCK_FILE);
    } catch (error) {
      if (error instanceof ConfigValidationError) throw new HarnessLockError(error.message, 2);
      throw error;
    }
  }
  return { configPath, config: parsed.config, raw: parsed.raw, specHash: fingerprint(parsed.raw), lockPath, lock };
}

export async function writeLock(lockPath: string, lock: HarnessLockFile): Promise<void> {
  await fs.writeFile(lockPath, serializeLock(lock), "utf8");
}
