import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import semver from "semver";
import type { AgentDetection, AgentId } from "../types/model.js";
import { homeDisplay, isFile, isRecord, listDir, pathExists, readTextIfExists } from "./fs-utils.js";

/**
 * Static agent installation & version detection.
 *
 * Versions are read from package metadata next to the binary found on PATH (npm global installs),
 * from native installer version directories, or from application bundles. Running
 * `<binary> --version` happens ONLY when `checkBinaries` is explicitly requested, and only for the
 * well-known agent binaries listed in each spec — never for anything discovered in config files.
 */

export interface DetectionContext {
  homeDir: string;
  env: Record<string, string | undefined>;
  platform: NodeJS.Platform;
}

export interface DetectSpec {
  agent: AgentId;
  /** Paths relative to the home directory whose existence marks the agent as installed. */
  homeMarkers: string[];
  binaries: string[];
  npmPackage?: string;
  /** Absolute package.json paths that carry the agent version. */
  packageJsonPaths?: string[];
  /** Absolute directories whose child directory names are installed versions. */
  versionDirs?: string[];
}

export interface DetectOptions {
  checkBinaries?: boolean;
}

export async function findOnPath(names: readonly string[], ctx: DetectionContext): Promise<string[]> {
  const rawPath = ctx.env.PATH ?? ctx.env.Path ?? ctx.env.path ?? "";
  const delimiter = ctx.platform === "win32" ? ";" : ":";
  const dirs = rawPath.split(delimiter).filter((d) => d.trim() !== "");
  const exts =
    ctx.platform === "win32"
      ? ["", ...(ctx.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").map((e) => e.toLowerCase()), ".ps1"]
      : [""];
  const found: string[] = [];
  for (const dir of dirs) {
    for (const name of names) {
      for (const ext of exts) {
        const candidate = path.join(dir.replace(/^"|"$/g, ""), name + ext);
        if (!found.includes(candidate) && (await isFile(candidate))) found.push(candidate);
      }
    }
  }
  return found;
}

async function readPkg(pkgPath: string): Promise<{ name?: string; version?: string } | undefined> {
  const text = await readTextIfExists(pkgPath);
  if (!text) return undefined;
  try {
    const parsed: unknown = JSON.parse(text);
    if (!isRecord(parsed)) return undefined;
    return {
      name: typeof parsed.name === "string" ? parsed.name : undefined,
      version: typeof parsed.version === "string" ? parsed.version : undefined,
    };
  } catch {
    return undefined;
  }
}

async function versionFromBinary(binPath: string, npmPackage: string): Promise<string | undefined> {
  const segments = npmPackage.split("/");
  const binDir = path.dirname(binPath);
  const candidates = [
    path.join(binDir, "node_modules", ...segments, "package.json"),
    path.join(binDir, "..", "lib", "node_modules", ...segments, "package.json"),
    path.join(binDir, "..", "node_modules", ...segments, "package.json"),
  ];
  try {
    let current = path.dirname(await fs.realpath(binPath));
    for (let i = 0; i < 6; i++) {
      candidates.push(path.join(current, "package.json"));
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
  } catch {
    // unreadable symlink: fall back to the static candidates
  }
  for (const candidate of candidates) {
    const pkg = await readPkg(candidate);
    if (pkg?.name === npmPackage && pkg.version) return pkg.version;
  }
  return undefined;
}

async function highestVersionDir(dir: string): Promise<string | undefined> {
  const versions = (await listDir(dir)).map((e) => e.name).filter((name) => semver.valid(name) !== null);
  return versions.sort(semver.rcompare)[0];
}

function runVersionFlag(binPath: string): Promise<string | undefined> {
  // Batch/PowerShell shims require a shell; we never spawn a shell.
  if (/\.(cmd|bat|ps1)$/i.test(binPath)) return Promise.resolve(undefined);
  return new Promise((resolve) => {
    execFile(binPath, ["--version"], { timeout: 5000, windowsHide: true, shell: false }, (error, stdout) => {
      if (error) return resolve(undefined);
      const match = /\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/.exec(String(stdout));
      resolve(match?.[0]);
    });
  });
}

export async function detectAgent(ctx: DetectionContext, spec: DetectSpec, options: DetectOptions = {}): Promise<AgentDetection> {
  const evidence: string[] = [];
  for (const marker of spec.homeMarkers) {
    const abs = path.join(ctx.homeDir, marker);
    if (await pathExists(abs)) evidence.push(homeDisplay(abs, ctx.homeDir));
  }
  const binaries = await findOnPath(spec.binaries, ctx);
  for (const bin of binaries) evidence.push(homeDisplay(bin, ctx.homeDir));

  let version: string | undefined;
  let versionSource: string | undefined;

  if (spec.npmPackage) {
    for (const bin of binaries) {
      version = await versionFromBinary(bin, spec.npmPackage);
      if (version) {
        versionSource = "package metadata";
        break;
      }
    }
  }
  if (!version) {
    for (const pkgPath of spec.packageJsonPaths ?? []) {
      const pkg = await readPkg(pkgPath);
      if (pkg?.version) {
        version = pkg.version;
        versionSource = "package metadata";
        if (!evidence.length) evidence.push(homeDisplay(pkgPath, ctx.homeDir));
        break;
      }
    }
  }
  if (!version) {
    for (const dir of spec.versionDirs ?? []) {
      const found = await highestVersionDir(dir);
      if (found) {
        version = found;
        versionSource = "install directory";
        break;
      }
    }
  }
  if (!version && options.checkBinaries) {
    for (const bin of binaries) {
      version = await runVersionFlag(bin);
      if (version) {
        versionSource = "--version";
        break;
      }
    }
  }

  return { agent: spec.agent, installed: evidence.length > 0, version, versionSource, evidence };
}
