import semver from "semver";
import { scanWorkspace } from "../adapters/index.js";
import { canonicalize } from "../core/canonical.js";
import { evaluatePermission, keyHooks, keySkills } from "../core/components.js";
import { uniqueSorted } from "../core/fs-utils.js";
import { evaluateInstructions } from "../core/instruction-sync.js";
import { createPalette, header } from "../reporter/tui.js";
import type { HarnessLockFile, LockMcpEntry } from "../schema/lock-schema.js";
import { VERSIONED_SOURCE_TYPES, type InstructionEvaluation, type MCPComponent, type WorkspaceScan } from "../types/model.js";
import { VERSION } from "../version.js";
import { loadProject, writeLock, type CommandContext, type Project } from "./context.js";

function compareVersionsDesc(a: string, b: string): number {
  const va = semver.valid(a);
  const vb = semver.valid(b);
  if (va && vb) return semver.rcompare(va, vb);
  return a < b ? 1 : a > b ? -1 : 0;
}

function resolveMcpVersion(component: MCPComponent, requested: string | undefined): { version?: string; from?: string } {
  if (!VERSIONED_SOURCE_TYPES.includes(component.sourceType)) return {};
  const pinned = uniqueSorted(
    component.definitions.filter((d) => d.isPinned && d.declaredVersion).map((d) => d.declaredVersion as string),
  ).sort(compareVersionsDesc);
  if (pinned.length > 0) {
    const inRange = requested && semver.validRange(requested) ? pinned.filter((v) => semver.valid(v) && semver.satisfies(v, requested)) : [];
    return { version: inRange[0] ?? pinned[0], from: "config" };
  }
  if (component.resolvedCacheVersion) return { version: component.resolvedCacheVersion, from: component.resolvedCacheSource };
  if (requested && semver.valid(requested)) return { version: semver.valid(requested) ?? requested, from: "harnesslock.yaml" };
  return {};
}

export interface BuiltLock {
  lock: HarnessLockFile;
  warnings: string[];
}

/** Builds the resolved, deterministic lockfile from the desired state and a workspace scan. */
export function buildLockfile(project: Project, scan: WorkspaceScan, instructions: InstructionEvaluation): BuiltLock {
  const { config } = project;
  const warnings: string[] = [];

  for (const issue of scan.parseErrors) warnings.push(`cannot parse ${issue.file}: ${issue.message}`);

  const agents: HarnessLockFile["agents"] = {};
  for (const [agent, entry] of Object.entries(config.agents)) {
    if (entry) agents[agent] = { requested: entry.version, presence: entry.presence };
  }

  const mcp: HarnessLockFile["mcp"] = {};
  for (const component of scan.mcps) {
    const declared = config.mcp[component.id];
    if (!declared) warnings.push(`MCP "${component.id}" is not declared in harnesslock.yaml (policy: unknown_project_mcp)`);
    const { version, from } = resolveMcpVersion(component, declared?.version);
    if (VERSIONED_SOURCE_TYPES.includes(component.sourceType)) {
      if (!component.isPinned) {
        warnings.push(
          `MCP "${component.id}" is unpinned in ${component.definitions.filter((d) => !d.isPinned).map((d) => d.file).join(", ")}` +
            (version ? ` — locking ${version} (${from}); run \`harnesslock sync --pin\`` : " and no cached version was found"),
        );
      }
      if (declared?.version && version && semver.valid(version) && semver.validRange(declared.version) && !semver.satisfies(version, declared.version)) {
        warnings.push(`MCP "${component.id}" resolves to ${version}, outside the requested range ${declared.version}`);
      }
    }
    const allowed = component.permissions.filter((p) => evaluatePermission(p, declared?.permissions, undefined) === "ok");
    for (const rejected of component.permissions.filter((p) => !allowed.includes(p))) {
      warnings.push(`MCP "${component.id}" grants "${rejected}", which harnesslock.yaml does not allow (not locked)`);
    }
    const entry: LockMcpEntry = {
      sourceType: component.sourceType,
      package: component.packageName,
      requestedVersion: declared?.version,
      resolvedVersion: version,
      resolvedFrom: from,
      definedIn: component.definedIn,
      pinnedInConfigs: component.definitions.filter((d) => d.isPinned && version !== undefined && d.declaredVersion === version).map((d) => d.file),
      requiredEnv: Object.keys(component.requiredEnv).length > 0 ? component.requiredEnv : undefined,
      permissions: { allowed },
      configFingerprint: component.fingerprint,
      configFingerprints: Object.fromEntries(component.definitions.map((d) => [d.file, d.fingerprint])),
    };
    mcp[component.id] = entry;
  }

  const skills: HarnessLockFile["skills"] = {};
  for (const [id, keyed] of [...keySkills(scan.skills, config)].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    skills[id] = { path: keyed.skill.path, agent: keyed.skill.agent, filesCount: keyed.skill.filesCount, fingerprint: keyed.skill.fingerprint };
  }
  for (const [name, decl] of Object.entries(config.skills)) {
    if (decl.required && !skills[name]) warnings.push(`required skill "${name}" not found at ${decl.path}`);
  }

  const hooks: HarnessLockFile["hooks"] = {};
  for (const [id, keyed] of [...keyHooks(scan.hooks, config)].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    hooks[id] = { event: keyed.event, agent: keyed.agent, files: keyed.files, fingerprint: keyed.fingerprint };
  }
  for (const [name, decl] of Object.entries(config.hooks)) {
    if (decl.required && !hooks[name]) warnings.push(`required hook "${name}" (${decl.event}) is not configured`);
  }

  const rules: HarnessLockFile["rules"] = {};
  for (const rule of [...scan.rules].sort((a, b) => (a.id < b.id ? -1 : 1))) rules[rule.id] = { agent: rule.agent, fingerprint: rule.fingerprint };

  const agentPermissions: HarnessLockFile["agentPermissions"] = {};
  for (const set of [...scan.permissions].sort((a, b) => (a.agent < b.agent ? -1 : 1))) {
    agentPermissions[set.agent] = { sources: set.sources, allow: set.allow, deny: set.deny, ask: set.ask };
  }

  const syncGroups: HarnessLockFile["instructions"]["syncGroups"] = {};
  for (const group of instructions.groups) {
    if (group.status === "desynced") warnings.push(`instruction group "${group.name}" is out of sync: ${group.message}`);
    syncGroups[group.name] = {
      files: config.instructions.syncGroups.find((g) => g.name === group.name)?.files ?? [],
      canonicalFingerprint: group.canonicalFingerprint,
    };
  }
  let files: Record<string, string> | undefined;
  if (instructions.strategy === "strict-hash") {
    files = {};
    for (const [file, hash] of Object.entries(instructions.fileHashes).sort(([a], [b]) => (a < b ? -1 : 1))) {
      if (hash) files[file] = hash;
      else warnings.push(`instruction file ${file} does not exist (strict-hash)`);
    }
  }

  const lock: HarnessLockFile = {
    lockVersion: 1,
    generatedAt: new Date().toISOString(),
    generator: `harnesslock@${VERSION}`,
    specHash: project.specHash,
    agents,
    mcp,
    skills,
    hooks,
    rules,
    agentPermissions,
    instructions: { strategy: instructions.strategy, syncGroups, files },
  };
  return { lock, warnings };
}

function withoutTimestamp(lock: HarnessLockFile): string {
  const { generatedAt: _generatedAt, ...rest } = lock;
  return canonicalize(JSON.parse(JSON.stringify(rest)));
}

export interface LockOptions {
  dryRun?: boolean;
}

export interface LockResult {
  lock: HarnessLockFile;
  warnings: string[];
  changed: boolean;
}

export async function lockWorkspace(ctx: CommandContext, options: LockOptions = {}): Promise<LockResult> {
  const project = await loadProject(ctx);
  const scan = await scanWorkspace(ctx);
  const instructions = await evaluateInstructions(ctx.root, project.config);
  const { lock, warnings } = buildLockfile(project, scan, instructions);
  // Keep the previous timestamp when nothing changed, so re-locking is byte-for-byte idempotent.
  const changed = !project.lock || withoutTimestamp(project.lock) !== withoutTimestamp(lock);
  if (!changed && project.lock) lock.generatedAt = project.lock.generatedAt;
  if (!options.dryRun && changed) await writeLock(project.lockPath, lock);
  return { lock, warnings, changed };
}

export async function runLock(ctx: CommandContext, options: LockOptions = {}): Promise<number> {
  const p = createPalette(ctx.color);
  const { lock, warnings, changed } = await lockWorkspace(ctx, options);
  const counts = [
    `${Object.keys(lock.mcp).length} MCP servers`,
    `${Object.keys(lock.skills).length} skills`,
    `${Object.keys(lock.hooks).length} hooks`,
    `${Object.keys(lock.rules).length} rules`,
    `${Object.keys(lock.instructions.syncGroups).length} instruction groups`,
  ].join(" · ");
  const out = [header(p, "Lock"), ""];
  if (options.dryRun) out.push(`  ${p.dim("○")} dry run — harnesslock.lock not written`);
  else if (changed) out.push(`  ${p.ok("✓")} Wrote harnesslock.lock`);
  else out.push(`  ${p.ok("✓")} harnesslock.lock is already up to date`);
  out.push(`    ${p.dim(counts)}`);
  for (const warning of warnings) out.push(`  ${p.warn("⚠")} ${warning}`);
  ctx.stdout(`${out.join("\n")}\n`);
  return 0;
}
