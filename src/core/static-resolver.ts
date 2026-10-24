import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import semver from "semver";
import { parse as parseYaml } from "yaml";
import type { McpSourceType, PackageSpecLocation } from "../types/model.js";
import { isRecord, listDir, readTextIfExists, safeStat } from "./fs-utils.js";

/**
 * Static, zero-execution resolution of MCP server launch commands.
 * Nothing in this module spawns a process: it only parses argv arrays and reads package metadata.
 */

export interface ParsedMcpCommand {
  sourceType: McpSourceType;
  /** The package runner (`npx`, `bunx`, `pnpm dlx`, `uvx`, `pipx run`, `docker run`, ...). */
  runner?: string;
  packageName?: string;
  declaredVersion?: string;
  isPinned: boolean;
  /** Location of the package spec inside the original args array. */
  specLocation?: PackageSpecLocation;
  /** Python extras (`[cli]`) to preserve when re-pinning. */
  specExtras?: string;
  /** Original args with the package spec stripped of its version (stable fingerprint input). */
  normalizedArgs: string[];
}

export function commandBaseName(command: string): string {
  const base = command.replace(/\\/g, "/").split("/").pop() ?? command;
  return base.toLowerCase().replace(/\.(cmd|exe|bat|ps1)$/, "");
}

/** `true` only for exact semver versions (`1.4.7`, `v1.4.7`, `1.0.0-beta.1`), never ranges or tags. */
export function isExactVersion(version: string | undefined): boolean {
  if (!version) return false;
  return semver.valid(version) !== null;
}

export function splitNpmSpec(spec: string): { name: string; version?: string } {
  const at = spec.lastIndexOf("@");
  if (at <= 0) return { name: spec };
  const name = spec.slice(0, at);
  const version = spec.slice(at + 1);
  if (name === "" || name === "@" || name.endsWith("/")) return { name: spec };
  return { name, version: version === "" ? undefined : version };
}

export interface PythonSpec {
  name: string;
  extras?: string;
  operator?: string;
  version?: string;
}

export function splitPythonSpec(spec: string): PythonSpec {
  const match = /^\s*([A-Za-z0-9][A-Za-z0-9._-]*)\s*(\[[^\]]*\])?\s*(?:(===|==|~=|!=|>=|<=|>|<|@)\s*([^\s;,]+))?/.exec(spec);
  if (!match) return { name: spec.trim() };
  const [, name = spec, extras, operator, version] = match;
  return { name, extras, operator, version };
}

export function splitDockerImage(image: string): { name: string; tag?: string; digest?: string } {
  let rest = image;
  let digest: string | undefined;
  const at = rest.indexOf("@");
  if (at >= 0) {
    digest = rest.slice(at + 1);
    rest = rest.slice(0, at);
  }
  const lastSlash = rest.lastIndexOf("/");
  const lastColon = rest.lastIndexOf(":");
  let tag: string | undefined;
  if (lastColon > lastSlash) {
    tag = rest.slice(lastColon + 1);
    rest = rest.slice(0, lastColon);
  }
  return { name: rest, tag, digest };
}

const NPX_VALUE_FLAGS = new Set(["-p", "--package", "-c", "--call", "--cache", "--registry", "--userconfig", "-w", "--workspace"]);
const UV_VALUE_FLAGS = new Set([
  "--from",
  "--with",
  "--with-editable",
  "--with-requirements",
  "--python",
  "-p",
  "--index",
  "--index-url",
  "--extra-index-url",
  "--default-index",
  "--directory",
  "--cache-dir",
  "--config-file",
  "--spec",
  "--pip-args",
  "--suffix",
]);
const DOCKER_VALUE_FLAGS = new Set([
  "-e",
  "--env",
  "--env-file",
  "-v",
  "--volume",
  "--mount",
  "-p",
  "--publish",
  "--name",
  "--network",
  "--net",
  "--entrypoint",
  "-w",
  "--workdir",
  "-u",
  "--user",
  "--platform",
  "-l",
  "--label",
  "--cpus",
  "-m",
  "--memory",
  "--add-host",
  "--cap-add",
  "--cap-drop",
  "--device",
  "-h",
  "--hostname",
  "--pull",
  "--restart",
  "--security-opt",
  "--tmpfs",
  "--ulimit",
  "--log-driver",
  "--log-opt",
  "--gpus",
  "--ipc",
  "--pid",
  "--shm-size",
]);

interface SpecHit {
  spec: string;
  location: PackageSpecLocation;
}

/** Finds the package spec for npx-style runners. `offset` maps local indices back to the original args. */
function findNpmSpec(args: readonly string[], offset: number): SpecHit | undefined {
  let explicit: SpecHit | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? "";
    if (arg === "--") {
      const next = args[i + 1];
      if (explicit) return explicit;
      return next === undefined ? undefined : { spec: next, location: { index: offset + i + 1, prefix: "" } };
    }
    if (arg.startsWith("--package=")) {
      explicit = { spec: arg.slice("--package=".length), location: { index: offset + i, prefix: "--package=" } };
      continue;
    }
    if (arg.startsWith("-")) {
      const flag = arg.split("=")[0] ?? arg;
      if (NPX_VALUE_FLAGS.has(flag) && !arg.includes("=")) {
        if ((flag === "-p" || flag === "--package") && args[i + 1] !== undefined) {
          explicit = { spec: args[i + 1] ?? "", location: { index: offset + i + 1, prefix: "" } };
        }
        i++;
      }
      continue;
    }
    return explicit ?? { spec: arg, location: { index: offset + i, prefix: "" } };
  }
  return explicit;
}

function findPythonSpec(args: readonly string[], offset: number): SpecHit | undefined {
  let explicit: SpecHit | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? "";
    if (arg === "--") {
      if (explicit) return explicit;
      const next = args[i + 1];
      return next === undefined ? undefined : { spec: next, location: { index: offset + i + 1, prefix: "" } };
    }
    if (arg.startsWith("--from=") || arg.startsWith("--spec=")) {
      const prefix = arg.slice(0, arg.indexOf("=") + 1);
      explicit = { spec: arg.slice(prefix.length), location: { index: offset + i, prefix } };
      continue;
    }
    if (arg.startsWith("-")) {
      const flag = arg.split("=")[0] ?? arg;
      if (UV_VALUE_FLAGS.has(flag) && !arg.includes("=")) {
        if ((flag === "--from" || flag === "--spec") && args[i + 1] !== undefined) {
          explicit = { spec: args[i + 1] ?? "", location: { index: offset + i + 1, prefix: "" } };
        }
        i++;
      }
      continue;
    }
    return explicit ?? { spec: arg, location: { index: offset + i, prefix: "" } };
  }
  return explicit;
}

function findDockerImage(args: readonly string[], offset: number): SpecHit | undefined {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? "";
    if (arg === "--") {
      const next = args[i + 1];
      return next === undefined ? undefined : { spec: next, location: { index: offset + i + 1, prefix: "" } };
    }
    if (arg.startsWith("-")) {
      const flag = arg.split("=")[0] ?? arg;
      if (DOCKER_VALUE_FLAGS.has(flag) && !arg.includes("=")) i++;
      continue;
    }
    return { spec: arg, location: { index: offset + i, prefix: "" } };
  }
  return undefined;
}

function withSpecReplaced(args: readonly string[], hit: SpecHit | undefined, replacement: string): string[] {
  const out = [...args];
  if (hit) out[hit.location.index] = hit.location.prefix + replacement;
  return out;
}

/**
 * Parses an MCP launch command (`command` + `args`) into its package source and version pin.
 * Supports npx / bunx / pnpm dlx / yarn dlx / npm exec, uvx / uv tool run / pipx run, docker/podman run,
 * and `cmd /c <runner> ...` wrappers used on Windows.
 */
export function parseMcpCommand(command: string, args: readonly string[]): ParsedMcpCommand {
  const base = commandBaseName(command);
  return parseFrom(base, args, 0, args);
}

function parseFrom(base: string, all: readonly string[], offset: number, original: readonly string[]): ParsedMcpCommand {
  const local = all.slice(offset);

  if (base === "cmd" && /^\/[cC]$/.test(local[0] ?? "") && local[1] !== undefined) {
    return parseFrom(commandBaseName(local[1]), all, offset + 2, original);
  }
  if ((base === "sh" || base === "bash") && local[0] === "-c") {
    // Shell wrappers hide the real argv; treat them as local commands (never executed).
    return { sourceType: "local", isPinned: true, normalizedArgs: [...original] };
  }

  let npmRunner: string | undefined;
  let npmOffset = offset;
  if (base === "npx" || base === "bunx" || base === "pnpx") {
    npmRunner = base;
  } else if ((base === "pnpm" || base === "yarn") && local[0] === "dlx") {
    npmRunner = `${base} dlx`;
    npmOffset = offset + 1;
  } else if (base === "npm" && (local[0] === "exec" || local[0] === "x")) {
    npmRunner = `npm ${local[0]}`;
    npmOffset = offset + 1;
  } else if (base === "bun" && local[0] === "x") {
    npmRunner = "bun x";
    npmOffset = offset + 1;
  }
  if (npmRunner) {
    const hit = findNpmSpec(all.slice(npmOffset), npmOffset);
    if (!hit) return { sourceType: "npm", runner: npmRunner, isPinned: false, normalizedArgs: [...original] };
    const { name, version } = splitNpmSpec(hit.spec);
    return {
      sourceType: "npm",
      runner: npmRunner,
      packageName: name,
      declaredVersion: version,
      isPinned: isExactVersion(version),
      specLocation: hit.location,
      normalizedArgs: withSpecReplaced(original, hit, name),
    };
  }

  let pyRunner: string | undefined;
  let pyOffset = offset;
  if (base === "uvx") {
    pyRunner = "uvx";
  } else if (base === "uv" && local[0] === "tool" && local[1] === "run") {
    pyRunner = "uv tool run";
    pyOffset = offset + 2;
  } else if (base === "pipx" && local[0] === "run") {
    pyRunner = "pipx run";
    pyOffset = offset + 1;
  }
  if (pyRunner) {
    const hit = findPythonSpec(all.slice(pyOffset), pyOffset);
    if (!hit) return { sourceType: "uvx", runner: pyRunner, isPinned: false, normalizedArgs: [...original] };
    const spec = splitPythonSpec(hit.spec);
    const exact =
      (spec.operator === "==" || spec.operator === "===" || spec.operator === "@") &&
      spec.version !== undefined &&
      spec.version !== "latest" &&
      !spec.version.includes("*");
    return {
      sourceType: "uvx",
      runner: pyRunner,
      packageName: spec.name,
      declaredVersion: spec.version,
      isPinned: exact,
      specLocation: hit.location,
      specExtras: spec.extras,
      normalizedArgs: withSpecReplaced(original, hit, `${spec.name}${spec.extras ?? ""}`),
    };
  }

  if ((base === "docker" || base === "podman") && (local[0] === "run" || (local[0] === "container" && local[1] === "run"))) {
    const runOffset = offset + (local[0] === "run" ? 1 : 2);
    const hit = findDockerImage(all.slice(runOffset), runOffset);
    if (!hit) return { sourceType: "docker", runner: `${base} run`, isPinned: false, normalizedArgs: [...original] };
    const image = splitDockerImage(hit.spec);
    const version = image.digest ?? image.tag;
    return {
      sourceType: "docker",
      runner: `${base} run`,
      packageName: image.name,
      declaredVersion: version,
      isPinned: Boolean(image.digest) || (image.tag !== undefined && image.tag !== "latest"),
      specLocation: hit.location,
      normalizedArgs: withSpecReplaced(original, hit, image.name),
    };
  }

  return { sourceType: "local", isPinned: true, normalizedArgs: [...original] };
}

/** Renders the package spec pinned to `version` for the given source type. */
export function formatPinnedSpec(
  sourceType: McpSourceType,
  packageName: string,
  version: string,
  extras?: string,
): string {
  switch (sourceType) {
    case "npm":
      return `${packageName}@${version}`;
    case "uvx":
      return `${packageName}${extras ?? ""}==${version}`;
    case "docker":
      return version.startsWith("sha256:") ? `${packageName}@${version}` : `${packageName}:${version}`;
    default:
      return packageName;
  }
}

// ---------------------------------------------------------------------------------------------
// Installed / cached version inspection (filesystem only)
// ---------------------------------------------------------------------------------------------

export interface ResolveOptions {
  env?: Record<string, string | undefined>;
  platform?: NodeJS.Platform;
}

export interface ResolvedPackageVersion {
  version: string;
  source: "node_modules" | "package-lock" | "pnpm-lock" | "npx-cache" | "uv-tools" | "uv-cache" | "pipx";
  path: string;
}

async function readPackageVersion(pkgJsonPath: string): Promise<string | undefined> {
  const text = await readTextIfExists(pkgJsonPath);
  if (text === undefined) return undefined;
  try {
    const parsed: unknown = JSON.parse(text);
    if (isRecord(parsed) && typeof parsed.version === "string") return parsed.version;
  } catch {
    // Corrupt cache entries are ignored.
  }
  return undefined;
}

function packageJsonPath(nodeModules: string, packageName: string): string {
  return path.join(nodeModules, ...packageName.split("/"), "package.json");
}

export function npxCacheRoots(homeDir: string, options: ResolveOptions = {}): string[] {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const roots: string[] = [];
  const configured = env.npm_config_cache ?? env.NPM_CONFIG_CACHE;
  if (configured) roots.push(path.join(configured, "_npx"));
  roots.push(path.join(homeDir, ".npm", "_npx"));
  if (platform === "win32" && env.LOCALAPPDATA) roots.push(path.join(env.LOCALAPPDATA, "npm-cache", "_npx"));
  return [...new Set(roots)];
}

interface Candidate {
  version: string;
  mtimeMs: number;
  path: string;
}

function pickBest(candidates: Candidate[]): Candidate | undefined {
  return [...candidates].sort((a, b) => {
    const va = semver.valid(a.version) ?? semver.valid(semver.coerce(a.version));
    const vb = semver.valid(b.version) ?? semver.valid(semver.coerce(b.version));
    if (va && vb && va !== vb) return semver.rcompare(va, vb);
    if (va && !vb) return -1;
    if (!va && vb) return 1;
    return b.mtimeMs - a.mtimeMs;
  })[0];
}

async function workspaceLockVersion(packageName: string, workspaceRoot: string): Promise<ResolvedPackageVersion | undefined> {
  const npmLockPath = path.join(workspaceRoot, "package-lock.json");
  const npmLockText = await readTextIfExists(npmLockPath);
  if (npmLockText) {
    try {
      const lock: unknown = JSON.parse(npmLockText);
      if (isRecord(lock)) {
        const packages = isRecord(lock.packages) ? lock.packages : undefined;
        const entry = packages?.[`node_modules/${packageName}`];
        if (isRecord(entry) && typeof entry.version === "string") {
          return { version: entry.version, source: "package-lock", path: npmLockPath };
        }
        const deps = isRecord(lock.dependencies) ? lock.dependencies : undefined;
        const legacy = deps?.[packageName];
        if (isRecord(legacy) && typeof legacy.version === "string") {
          return { version: legacy.version, source: "package-lock", path: npmLockPath };
        }
      }
    } catch {
      // ignore malformed lockfiles
    }
  }

  const pnpmLockPath = path.join(workspaceRoot, "pnpm-lock.yaml");
  const pnpmText = await readTextIfExists(pnpmLockPath);
  if (pnpmText) {
    try {
      const lock: unknown = parseYaml(pnpmText);
      if (isRecord(lock)) {
        const importers = isRecord(lock.importers) ? lock.importers : undefined;
        const rootImporter = importers && isRecord(importers["."]) ? importers["."] : lock;
        for (const field of ["dependencies", "devDependencies", "optionalDependencies"]) {
          const deps = isRecord(rootImporter[field]) ? (rootImporter[field] as Record<string, unknown>) : undefined;
          const dep = deps?.[packageName];
          const raw = isRecord(dep) ? dep.version : dep;
          if (typeof raw === "string") {
            const version = raw.split("(")[0] ?? raw;
            if (semver.valid(version)) return { version, source: "pnpm-lock", path: pnpmLockPath };
          }
        }
      }
    } catch {
      // ignore malformed lockfiles
    }
  }
  return undefined;
}

/**
 * Locates the installed version of an npm package without executing anything:
 * 1. `<workspace>/node_modules/<pkg>/package.json`
 * 2. `<workspace>/package-lock.json` / `pnpm-lock.yaml`
 * 3. npx cache (`~/.npm/_npx/<hash>/node_modules/<pkg>/package.json`, plus `npm_config_cache` and
 *    `%LOCALAPPDATA%\npm-cache` on Windows) — the highest cached version wins, ties broken by mtime.
 */
export async function locateInstalledNpmPackage(
  packageName: string,
  workspaceRoot: string,
  homeDir?: string,
  options: ResolveOptions = {},
): Promise<ResolvedPackageVersion | undefined> {
  const localPkg = packageJsonPath(path.join(workspaceRoot, "node_modules"), packageName);
  const localVersion = await readPackageVersion(localPkg);
  if (localVersion) return { version: localVersion, source: "node_modules", path: localPkg };

  const fromLock = await workspaceLockVersion(packageName, workspaceRoot);
  if (fromLock) return fromLock;

  const candidates: Candidate[] = [];
  for (const root of npxCacheRoots(homeDir ?? os.homedir(), options)) {
    for (const entry of await listDir(root)) {
      if (!entry.isDirectory()) continue;
      const pkgPath = packageJsonPath(path.join(root, entry.name, "node_modules"), packageName);
      const version = await readPackageVersion(pkgPath);
      if (!version) continue;
      const stat = await safeStat(pkgPath);
      candidates.push({ version, mtimeMs: stat?.mtimeMs ?? 0, path: pkgPath });
    }
  }
  const best = pickBest(candidates);
  return best ? { version: best.version, source: "npx-cache", path: best.path } : undefined;
}

export async function resolveInstalledNpmVersion(
  packageName: string,
  workspaceRoot: string,
  homeDir?: string,
  options: ResolveOptions = {},
): Promise<string | undefined> {
  return (await locateInstalledNpmPackage(packageName, workspaceRoot, homeDir, options))?.version;
}

/** PEP 503 normalization, as used for `.dist-info` directory names. */
export function normalizePythonName(name: string): string {
  return name.toLowerCase().replace(/[-_.]+/g, "_");
}

function pythonRoots(homeDir: string, options: ResolveOptions): Array<{ dir: string; source: ResolvedPackageVersion["source"] }> {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const roots: Array<{ dir: string; source: ResolvedPackageVersion["source"] }> = [];
  if (env.UV_TOOL_DIR) roots.push({ dir: env.UV_TOOL_DIR, source: "uv-tools" });
  const dataHome = env.XDG_DATA_HOME ?? path.join(homeDir, ".local", "share");
  roots.push({ dir: path.join(dataHome, "uv", "tools"), source: "uv-tools" });
  if (platform === "win32" && env.APPDATA) roots.push({ dir: path.join(env.APPDATA, "uv", "data", "tools"), source: "uv-tools" });
  if (env.PIPX_HOME) roots.push({ dir: path.join(env.PIPX_HOME, "venvs"), source: "pipx" });
  roots.push({ dir: path.join(homeDir, ".local", "pipx", "venvs"), source: "pipx" });
  roots.push({ dir: path.join(dataHome, "pipx", "venvs"), source: "pipx" });
  if (env.UV_CACHE_DIR) roots.push({ dir: path.join(env.UV_CACHE_DIR, "archive-v0"), source: "uv-cache" });
  const cacheHome = env.XDG_CACHE_HOME ?? path.join(homeDir, ".cache");
  roots.push({ dir: path.join(cacheHome, "uv", "archive-v0"), source: "uv-cache" });
  if (platform === "win32" && env.LOCALAPPDATA) {
    roots.push({ dir: path.join(env.LOCALAPPDATA, "uv", "cache", "archive-v0"), source: "uv-cache" });
  }
  const seen = new Set<string>();
  return roots.filter((root) => (seen.has(root.dir) ? false : (seen.add(root.dir), true)));
}

/** Bounded breadth-first search for `site-packages/<name>-<version>.dist-info/METADATA`. */
async function findDistInfo(root: string, normalized: string, maxDirs = 4000): Promise<Candidate[]> {
  const found: Candidate[] = [];
  const queue: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }];
  let visited = 0;
  while (queue.length > 0 && visited < maxDirs) {
    const { dir, depth } = queue.shift() as { dir: string; depth: number };
    visited++;
    for (const entry of await listDir(dir)) {
      if (!entry.isDirectory()) continue;
      const full = path.join(dir, entry.name);
      if (entry.name.endsWith(".dist-info")) {
        const stem = entry.name.slice(0, -".dist-info".length);
        const dash = stem.lastIndexOf("-");
        if (dash <= 0) continue;
        if (normalizePythonName(stem.slice(0, dash)) !== normalized) continue;
        const metadataPath = path.join(full, "METADATA");
        const metadata = await readTextIfExists(metadataPath);
        const version = metadata ? /^Version:\s*(\S+)/m.exec(metadata)?.[1] : stem.slice(dash + 1);
        if (!version) continue;
        const stat = await safeStat(metadataPath);
        found.push({ version, mtimeMs: stat?.mtimeMs ?? 0, path: metadataPath });
      } else if (depth < 6 && entry.name !== "__pycache__" && entry.name !== "bin" && entry.name !== "Scripts") {
        queue.push({ dir: full, depth: depth + 1 });
      }
    }
  }
  return found;
}

/** Inspects uv tool installs, uv's archive cache and pipx venvs for an installed Python package. */
export async function locateInstalledPythonPackage(
  packageName: string,
  homeDir?: string,
  options: ResolveOptions = {},
): Promise<ResolvedPackageVersion | undefined> {
  const normalized = normalizePythonName(packageName);
  for (const root of pythonRoots(homeDir ?? os.homedir(), options)) {
    const stat = await safeStat(root.dir);
    if (!stat?.isDirectory()) continue;
    // Tool/venv roots contain one directory per package; search the matching one first.
    let searchRoots = [root.dir];
    if (root.source !== "uv-cache") {
      const direct = (await listDir(root.dir)).filter((e) => e.isDirectory() && normalizePythonName(e.name) === normalized);
      searchRoots = direct.map((e) => path.join(root.dir, e.name));
      if (searchRoots.length === 0) continue;
    }
    const candidates: Candidate[] = [];
    for (const dir of searchRoots) candidates.push(...(await findDistInfo(dir, normalized)));
    const best = pickBest(candidates);
    if (best) return { version: best.version, source: root.source, path: best.path };
  }
  return undefined;
}

export async function resolveInstalledPythonVersion(
  packageName: string,
  homeDir?: string,
  options: ResolveOptions = {},
): Promise<string | undefined> {
  return (await locateInstalledPythonPackage(packageName, homeDir, options))?.version;
}

/** Resolves the locally available version for a parsed MCP command, by source type. */
export async function resolveCachedVersion(
  sourceType: McpSourceType,
  packageName: string | undefined,
  workspaceRoot: string,
  homeDir?: string,
  options: ResolveOptions = {},
): Promise<ResolvedPackageVersion | undefined> {
  if (!packageName) return undefined;
  if (sourceType === "npm") return locateInstalledNpmPackage(packageName, workspaceRoot, homeDir, options);
  if (sourceType === "uvx") return locateInstalledPythonPackage(packageName, homeDir, options);
  return undefined;
}

/** Exposed for tests and `doctor`: lists npx cache directories that exist. */
export async function existingNpxCacheRoots(homeDir: string, options: ResolveOptions = {}): Promise<string[]> {
  const out: string[] = [];
  for (const root of npxCacheRoots(homeDir, options)) {
    try {
      if ((await fs.stat(root)).isDirectory()) out.push(root);
    } catch {
      // missing cache directory
    }
  }
  return out;
}
