import semver from "semver";
import type { PolicyKey, ResolvedConfig } from "../schema/config-schema.js";
import type { HarnessLockFile } from "../schema/lock-schema.js";
import {
  AGENT_LABELS,
  VERSIONED_SOURCE_TYPES,
  type AgentDetection,
  type AgentId,
  type ComponentStatus,
  type DriftEvent,
  type InstructionEvaluation,
  type ReportSection,
  type Severity,
  type ShadowingReport,
  type WorkspaceScan,
} from "../types/model.js";
import { shortHash } from "./canonical.js";
import { evaluatePermission, keyHooks, keySkills } from "./components.js";
import { uniqueSorted } from "./fs-utils.js";

/** A drift event before policy evaluation. */
export interface RawDriftEvent extends Omit<DriftEvent, "severity"> {
  defaultSeverity: Severity;
  /** Policy key that decides the final severity (`error` / `warn` / `off`). */
  policy?: PolicyKey;
  /** Severity is fixed regardless of policy (e.g. `require_pinned: true`, `required: true`). */
  forced?: boolean;
}

export interface DriftInput {
  mode: "local" | "ci";
  config: ResolvedConfig;
  specHash: string;
  lock?: HarnessLockFile;
  scan: WorkspaceScan;
  instructions: InstructionEvaluation;
  agents?: AgentDetection[];
  shadowing?: ShadowingReport;
}

export interface DriftResult {
  events: RawDriftEvent[];
  components: ComponentStatus[];
}

class Collector {
  readonly events: RawDriftEvent[] = [];
  readonly components: ComponentStatus[] = [];

  add(event: RawDriftEvent): void {
    this.events.push(event);
  }

  ok(section: ReportSection, id: string, detail: string): void {
    this.components.push({ section, id, state: "ok", detail });
  }

  skipped(section: ReportSection, id: string, detail: string): void {
    this.components.push({ section, id, state: "skipped", detail });
  }

  count(): number {
    return this.events.length;
  }
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;

function checkLock(input: DriftInput, c: Collector): void {
  for (const issue of input.scan.parseErrors) {
    c.add({
      code: "CONFIG_PARSE_ERROR",
      section: "lock",
      componentId: issue.file,
      file: issue.file,
      message: `cannot parse ${issue.file}: ${issue.message}`,
      defaultSeverity: "error",
      remediation: `Fix the syntax error in ${issue.file}`,
    });
  }
  if (!input.lock) {
    c.add({
      code: "LOCK_MISSING",
      section: "lock",
      componentId: "harnesslock.lock",
      file: "harnesslock.lock",
      message: "harnesslock.lock not found",
      defaultSeverity: "error",
      remediation: "npx harnesslock lock",
    });
    return;
  }
  if (input.lock.specHash !== input.specHash) {
    c.add({
      code: "SPEC_HASH_MISMATCH",
      section: "lock",
      componentId: "harnesslock.lock",
      file: "harnesslock.yaml",
      message: "harnesslock.yaml changed since harnesslock.lock was generated",
      expected: input.lock.specHash,
      actual: input.specHash,
      defaultSeverity: "error",
      remediation: "npx harnesslock lock",
    });
  }
}

function checkAgents(input: DriftInput, c: Collector): void {
  const entries = Object.entries(input.config.agents) as Array<[AgentId, { version?: string; presence: string }]>;
  if (entries.length === 0) return;
  if (input.mode === "ci") {
    for (const [agent] of entries) c.skipped("agents", AGENT_LABELS[agent], "repository mode (--ci): installation not checked");
    return;
  }
  let active = 0;
  for (const [agent, conf] of entries) {
    const label = AGENT_LABELS[agent];
    const detection = input.agents?.find((d) => d.agent === agent);
    if (!detection?.installed) {
      if (conf.presence === "required") {
        c.add({
          code: "AGENT_NOT_INSTALLED",
          section: "agents",
          componentId: label,
          message: "required agent is not installed",
          expected: conf.version ? `installed (${conf.version})` : "installed",
          actual: "not installed",
          defaultSeverity: "error",
          forced: true,
        });
      } else {
        c.skipped("agents", label, "not installed (skipped by policy)");
      }
      continue;
    }
    if (conf.version && detection.version) {
      if (semver.satisfies(detection.version, conf.version, { includePrerelease: true })) {
        active++;
        c.ok("agents", label, `${detection.version} (satisfies ${conf.version})`);
      } else {
        if (conf.presence === "optional") active++;
        c.add({
          code: "AGENT_VERSION_MISMATCH",
          section: "agents",
          componentId: label,
          message: `${detection.version} does not satisfy ${conf.version}`,
          expected: conf.version,
          actual: detection.version,
          defaultSeverity: conf.presence === "optional" ? "warning" : "error",
          forced: true,
          remediation: `Update ${label} to a version matching ${conf.version}`,
        });
      }
      continue;
    }
    active++;
    if (conf.version) {
      c.ok("agents", label, "installed (version not statically resolvable; use --check-binaries)");
    } else {
      c.ok("agents", label, detection.version ? `${detection.version} (installed)` : "installed");
    }
  }
  if (input.config.agentStrategy.requireAtLeastOne && active === 0) {
    c.add({
      code: "NO_ACTIVE_AGENT",
      section: "agents",
      componentId: "agents",
      message: `none of the configured agents (${entries.map(([a]) => AGENT_LABELS[a]).join(", ")}) is installed and compliant`,
      defaultSeverity: "error",
      forced: true,
      remediation: "Install at least one configured agent",
    });
  }
}

function checkInstructions(input: DriftInput, c: Collector): void {
  const { instructions, lock } = input;
  for (const group of instructions.groups) {
    if (group.status === "synced") {
      c.ok("instructions", group.name, group.message);
    } else if (group.status === "desynced") {
      const first = group.files.find((f) => f.exists);
      const differing = group.files.find((f) => f.exists && f.hash !== first?.hash);
      c.add({
        code: "CROSS_AGENT_INSTRUCTION_DESYNC",
        section: "instructions",
        componentId: group.name,
        file: group.newestFile ?? differing?.path,
        message: `cross-agent instruction drift: ${group.message}`,
        expected: first?.hash ? `${first.path} sha256:${shortHash(first.hash)}` : undefined,
        actual: differing?.hash ? `${differing.path} sha256:${shortHash(differing.hash)}` : undefined,
        defaultSeverity: group.enforceIdentical ? "error" : "warning",
        policy: group.enforceIdentical ? "instruction_drift" : undefined,
        remediation: "npx harnesslock sync --sync-instructions",
      });
    } else {
      c.skipped("instructions", group.name, group.message);
    }
  }

  if (instructions.strategy === "strict-hash") {
    const locked = lock?.instructions.files ?? {};
    for (const file of Object.keys(locked).sort()) {
      const expected = locked[file];
      const actual = instructions.fileHashes[file];
      if (actual === undefined) {
        c.add({
          code: "INSTRUCTION_MISSING",
          section: "instructions",
          componentId: file,
          file,
          message: `${file} is locked but missing`,
          defaultSeverity: "error",
          policy: "instruction_drift",
        });
      } else if (actual !== expected) {
        c.add({
          code: "INSTRUCTION_HASH_MISMATCH",
          section: "instructions",
          componentId: file,
          file,
          message: `${file} content differs from harnesslock.lock (strict-hash)`,
          expected,
          actual,
          defaultSeverity: "error",
          policy: "instruction_drift",
          remediation: "Review the change, then run: npx harnesslock lock",
        });
      } else {
        c.ok("instructions", file, `sha256:${shortHash(actual)} (locked)`);
      }
    }
  }

  if (instructions.strategy === "git-clean") {
    for (const file of Object.keys(instructions.gitStatus).sort()) {
      const state = instructions.gitStatus[file];
      if (state === "clean") c.ok("instructions", file, "clean (matches git index)");
      else if (state === "no-repo") c.skipped("instructions", file, "not a git repository");
      else if (state === "missing") c.skipped("instructions", file, "not present");
      else if (state === "untracked") {
        c.add({
          code: "INSTRUCTION_UNTRACKED",
          section: "instructions",
          componentId: file,
          file,
          message: `${file} is not tracked by git`,
          defaultSeverity: "warning",
          remediation: `git add ${file}`,
        });
      } else {
        c.add({
          code: "INSTRUCTION_DIRTY",
          section: "instructions",
          componentId: file,
          file,
          message: `${file} has uncommitted local modifications`,
          defaultSeverity: "error",
          policy: "instruction_drift",
          remediation: `Commit or discard local changes to ${file}`,
        });
      }
    }
  }
}

function checkMcp(input: DriftInput, c: Collector): void {
  const { config, lock, scan } = input;
  const lockMcp = lock?.mcp ?? {};
  const actual = new Map(scan.mcps.map((m) => [m.id, m]));
  const ids = uniqueSorted([...Object.keys(lockMcp), ...actual.keys(), ...Object.keys(config.mcp)]);

  for (const id of ids) {
    const locked = lockMcp[id];
    const component = actual.get(id);
    const declared = config.mcp[id];
    const before = c.count();

    if (!component) {
      if (locked && locked.definedIn.length > 0) {
        for (const file of locked.definedIn) {
          c.add({
            code: "MCP_REMOVED",
            section: "mcp",
            componentId: id,
            file,
            message: `locked server is no longer configured in ${file}`,
            defaultSeverity: "error",
            policy: "mcp_drift",
            remediation: "Restore the server or run: npx harnesslock lock",
          });
        }
      } else if (declared) {
        c.add({
          code: "MCP_DECLARED_NOT_CONFIGURED",
          section: "mcp",
          componentId: id,
          message: "declared in harnesslock.yaml but not configured in any agent config",
          defaultSeverity: "warning",
        });
      }
      continue;
    }

    if (!declared) {
      c.add({
        code: "MCP_UNKNOWN",
        section: "mcp",
        componentId: id,
        file: component.definedIn[0],
        message: `not declared in harnesslock.yaml (configured in ${component.definedIn.join(", ")})`,
        defaultSeverity: "error",
        policy: "unknown_project_mcp",
        remediation: `Declare "${id}" under mcp: in harnesslock.yaml, or remove it`,
      });
    }
    if (!locked) {
      if (input.lock && declared) {
        c.add({
          code: "MCP_NOT_LOCKED",
          section: "mcp",
          componentId: id,
          file: component.definedIn[0],
          message: "configured but missing from harnesslock.lock",
          defaultSeverity: "error",
          policy: "mcp_drift",
          remediation: "npx harnesslock lock",
        });
      }
      continue;
    }

    for (const def of component.definitions) {
      if (!locked.definedIn.includes(def.file)) {
        c.add({
          code: "MCP_CONFIG_DRIFT",
          section: "mcp",
          componentId: id,
          file: def.file,
          message: `newly configured in ${def.file} (not in harnesslock.lock)`,
          defaultSeverity: "error",
          policy: "mcp_drift",
          remediation: "Review the change, then run: npx harnesslock lock",
        });
      } else if (locked.configFingerprints[def.file] !== def.fingerprint) {
        c.add({
          code: "MCP_CONFIG_DRIFT",
          section: "mcp",
          componentId: id,
          file: def.file,
          message: `command, arguments or environment changed in ${def.file}`,
          expected: locked.configFingerprints[def.file],
          actual: def.fingerprint,
          defaultSeverity: "error",
          policy: "mcp_drift",
          remediation: "npx harnesslock diff",
        });
      }
      if (locked.package && def.packageName && locked.package !== def.packageName) {
        c.add({
          code: "MCP_SOURCE_CHANGED",
          section: "mcp",
          componentId: id,
          file: def.file,
          message: `package source changed in ${def.file}`,
          expected: locked.package,
          actual: def.packageName,
          defaultSeverity: "error",
          policy: "mcp_drift",
        });
      }
      if (VERSIONED_SOURCE_TYPES.includes(def.sourceType)) {
        if (!def.isPinned) {
          const cached = component.resolvedCacheVersion ? ` (cached: ${component.resolvedCacheVersion})` : "";
          c.add({
            code: "MCP_UNPINNED",
            section: "mcp",
            componentId: id,
            file: def.file,
            message: locked.resolvedVersion ? "version drift & unpinned config" : "unpinned MCP version",
            expected: locked.resolvedVersion ? `${locked.resolvedVersion} (pinned)` : "an exact pinned version",
            actual: `${def.declaredVersion ?? "unversioned"} in ${def.file}${cached}`,
            defaultSeverity: "error",
            policy: "unpinned_mcp_version",
            forced: declared?.requirePinned === true,
            remediation: "npx harnesslock sync --pin",
          });
        } else if (locked.resolvedVersion && def.declaredVersion !== locked.resolvedVersion) {
          c.add({
            code: "MCP_VERSION_DRIFT",
            section: "mcp",
            componentId: id,
            file: def.file,
            message: "version drift",
            expected: `${locked.resolvedVersion} (pinned)`,
            actual: `${def.declaredVersion} in ${def.file}`,
            defaultSeverity: "error",
            policy: "mcp_drift",
            remediation: "npx harnesslock sync",
          });
        }
      }
      for (const envName of declared?.requiredEnv ?? []) {
        if (!(envName in def.env)) {
          c.add({
            code: "MCP_ENV_MISSING",
            section: "mcp",
            componentId: id,
            file: def.file,
            message: `required environment variable ${envName} is not passed in ${def.file}`,
            defaultSeverity: "warning",
          });
        }
      }
    }
    for (const file of locked.definedIn) {
      if (!component.definedIn.includes(file)) {
        c.add({
          code: "MCP_REMOVED",
          section: "mcp",
          componentId: id,
          file,
          message: `locked server is no longer configured in ${file}`,
          defaultSeverity: "error",
          policy: "mcp_drift",
          remediation: "Restore the server or run: npx harnesslock lock",
        });
      }
    }
    if (
      declared?.version &&
      locked.resolvedVersion &&
      semver.valid(locked.resolvedVersion) &&
      semver.validRange(declared.version) &&
      !semver.satisfies(locked.resolvedVersion, declared.version, { includePrerelease: true })
    ) {
      c.add({
        code: "MCP_VERSION_OUT_OF_RANGE",
        section: "mcp",
        componentId: id,
        message: `resolved ${locked.resolvedVersion} does not satisfy ${declared.version}`,
        expected: declared.version,
        actual: locked.resolvedVersion,
        defaultSeverity: "error",
        policy: "mcp_drift",
      });
    }

    if (c.count() === before) {
      if (VERSIONED_SOURCE_TYPES.includes(component.sourceType)) {
        c.ok("mcp", id, `${locked.resolvedVersion ?? "unresolved"} (pinned across ${plural(locked.pinnedInConfigs.length, "config")})`);
      } else if (component.sourceType === "http") {
        c.ok("mcp", id, `remote server (${plural(component.definedIn.length, "config")})`);
      } else {
        c.ok("mcp", id, `local command (${plural(component.definedIn.length, "config")})`);
      }
    }
  }
}

function checkSkills(input: DriftInput, c: Collector): void {
  const keyed = keySkills(input.scan.skills, input.config);
  const locked = input.lock?.skills ?? {};
  for (const [name, decl] of Object.entries(input.config.skills)) {
    if (decl.required && !keyed.has(name)) {
      c.add({
        code: "SKILL_MISSING",
        section: "skills",
        componentId: name,
        file: decl.path,
        message: `required skill not found at ${decl.path}`,
        defaultSeverity: "error",
        forced: true,
      });
    }
  }
  if (!input.lock) return;
  for (const id of uniqueSorted([...Object.keys(locked), ...keyed.keys()])) {
    const l = locked[id];
    const a = keyed.get(id);
    if (l && !a) {
      if (input.config.skills[id]?.required) continue;
      c.add({
        code: "SKILL_REMOVED",
        section: "skills",
        componentId: id,
        file: l.path,
        message: `locked skill removed from ${l.path}`,
        defaultSeverity: "error",
        policy: "skill_drift",
        remediation: "Restore the skill or run: npx harnesslock lock",
      });
    } else if (!l && a) {
      c.add({
        code: "SKILL_ADDED",
        section: "skills",
        componentId: id,
        file: a.skill.path,
        message: `new skill at ${a.skill.path} is not in harnesslock.lock`,
        defaultSeverity: "error",
        policy: "skill_drift",
        remediation: "Review the skill, then run: npx harnesslock lock",
      });
    } else if (l && a) {
      if (l.fingerprint !== a.skill.fingerprint) {
        c.add({
          code: "SKILL_DRIFT",
          section: "skills",
          componentId: id,
          file: a.skill.path,
          message: `skill contents changed (${plural(a.skill.filesCount, "file")})`,
          expected: l.fingerprint,
          actual: a.skill.fingerprint,
          defaultSeverity: "error",
          policy: "skill_drift",
          remediation: "Review the change, then run: npx harnesslock lock",
        });
      } else {
        c.ok("skills", id, `sha256:${shortHash(l.fingerprint)} (${plural(l.filesCount, "file")})`);
      }
    }
  }
}

function checkHooks(input: DriftInput, c: Collector): void {
  const keyed = keyHooks(input.scan.hooks, input.config);
  const locked = input.lock?.hooks ?? {};
  for (const [name, decl] of Object.entries(input.config.hooks)) {
    if (decl.required && !keyed.has(name)) {
      c.add({
        code: "HOOK_MISSING",
        section: "hooks",
        componentId: name,
        message: `required ${decl.event} hook is not configured`,
        defaultSeverity: "error",
        forced: true,
      });
    }
  }
  if (!input.lock) return;
  for (const id of uniqueSorted([...Object.keys(locked), ...keyed.keys()])) {
    const l = locked[id];
    const a = keyed.get(id);
    if (l && !a) {
      if (input.config.hooks[id]?.required) continue;
      c.add({
        code: "HOOK_REMOVED",
        section: "hooks",
        componentId: id,
        file: l.files[0],
        message: `locked ${l.event} hook removed`,
        defaultSeverity: "error",
        policy: "hook_drift",
        remediation: "Restore the hook or run: npx harnesslock lock",
      });
    } else if (!l && a) {
      c.add({
        code: "HOOK_ADDED",
        section: "hooks",
        componentId: id,
        file: a.files[0],
        message: `new ${a.event} hook in ${a.files.join(", ")} is not in harnesslock.lock`,
        defaultSeverity: "error",
        policy: "hook_drift",
        remediation: "Review the hook, then run: npx harnesslock lock",
      });
    } else if (l && a) {
      if (l.fingerprint !== a.fingerprint) {
        c.add({
          code: "HOOK_DRIFT",
          section: "hooks",
          componentId: id,
          file: a.files[0],
          message: `${a.event} hook command or script changed`,
          expected: l.fingerprint,
          actual: a.fingerprint,
          defaultSeverity: "error",
          policy: "hook_drift",
          remediation: "Review the change, then run: npx harnesslock lock",
        });
      } else {
        c.ok("hooks", id, `${l.event} (verified)`);
      }
    }
  }
}

function checkRules(input: DriftInput, c: Collector): void {
  if (!input.lock) return;
  const locked = input.lock.rules;
  const actual = new Map(input.scan.rules.map((r) => [r.id, r]));
  for (const id of uniqueSorted([...Object.keys(locked), ...actual.keys()])) {
    const l = locked[id];
    const a = actual.get(id);
    if (l && !a) {
      c.add({ code: "RULE_REMOVED", section: "rules", componentId: id, file: id, message: "locked rule file removed", defaultSeverity: "warning", policy: "rule_drift", remediation: "npx harnesslock lock" });
    } else if (!l && a) {
      c.add({ code: "RULE_ADDED", section: "rules", componentId: id, file: id, message: "new rule file is not in harnesslock.lock", defaultSeverity: "warning", policy: "rule_drift", remediation: "npx harnesslock lock" });
    } else if (l && a) {
      if (l.fingerprint !== a.fingerprint) {
        c.add({
          code: "RULE_DRIFT",
          section: "rules",
          componentId: id,
          file: id,
          message: "rule contents changed",
          expected: l.fingerprint,
          actual: a.fingerprint,
          defaultSeverity: "warning",
          policy: "rule_drift",
          remediation: "npx harnesslock lock",
        });
      } else {
        c.ok("rules", id, `sha256:${shortHash(l.fingerprint)}`);
      }
    }
  }
}

function checkPermissions(input: DriftInput, c: Collector): void {
  const lockMcp = input.lock?.mcp ?? {};
  for (const component of input.scan.mcps) {
    if (component.permissions.length === 0) continue;
    const declared = input.config.mcp[component.id];
    const lockedAllowed = lockMcp[component.id]?.permissions.allowed ?? (input.lock ? [] : undefined);
    const before = c.count();
    for (const def of component.definitions) {
      for (const permission of def.permissions) {
        const verdict = evaluatePermission(permission, declared?.permissions, lockedAllowed);
        if (verdict === "ok") continue;
        c.add({
          code: "UNEXPECTED_PERMISSION",
          section: "security",
          componentId: component.id,
          file: def.file,
          message: `${verdict === "denied" ? "denied" : "unexpected"} permission: ${permission}`,
          expected: declared?.permissions?.allow ? `within allow list [${declared.permissions.allow.join(", ")}]` : "permissions recorded in harnesslock.lock",
          actual: `${permission} in ${def.file}`,
          defaultSeverity: "error",
          policy: "unexpected_permissions",
          remediation: "npx harnesslock sync",
        });
      }
    }
    if (c.count() === before) c.ok("security", component.id, `${plural(component.permissions.length, "permission")} within policy`);
  }

  if (!input.lock) return;
  const lockedSets = input.lock.agentPermissions;
  const actualSets = new Map(input.scan.permissions.map((p) => [p.agent, p]));
  for (const agent of uniqueSorted([...Object.keys(lockedSets), ...actualSets.keys()]) as AgentId[]) {
    const label = AGENT_LABELS[agent] ?? agent;
    const l = lockedSets[agent] ?? { sources: [], allow: [], deny: [], ask: [] };
    const a = actualSets.get(agent) ?? { agent, sources: [], allow: [], deny: [], ask: [] };
    const before = c.count();
    for (const rule of a.allow.filter((r) => !l.allow.includes(r))) {
      c.add({
        code: "UNEXPECTED_PERMISSION",
        section: "security",
        componentId: label,
        file: a.sources[0],
        message: `unexpected permission: ${rule}`,
        expected: "allow rules recorded in harnesslock.lock",
        actual: `${rule} in ${a.sources.join(", ")}`,
        defaultSeverity: "error",
        policy: "unexpected_permissions",
        remediation: "Remove the rule, or review and run: npx harnesslock lock",
      });
    }
    for (const rule of l.deny.filter((r) => !a.deny.includes(r))) {
      c.add({
        code: "PERMISSION_GUARD_REMOVED",
        section: "security",
        componentId: label,
        file: a.sources[0] ?? l.sources[0],
        message: `deny rule removed: ${rule}`,
        expected: `deny ${rule}`,
        actual: "absent",
        defaultSeverity: "error",
        policy: "unexpected_permissions",
        remediation: "Restore the deny rule, or review and run: npx harnesslock lock",
      });
    }
    if (c.count() === before && a.sources.length > 0) {
      c.ok("security", label, `allow ${a.allow.length} · deny ${a.deny.length} (matches lock)`);
    }
  }
}

function checkShadowing(input: DriftInput, c: Collector): void {
  const report = input.shadowing;
  if (input.mode === "ci" || !report) return;
  let flagged = false;
  for (const source of report.sources) {
    if (source.unapprovedMcpCount === 0 && source.unapprovedHookCount === 0) continue;
    flagged = true;
    const parts: string[] = [];
    if (source.unapprovedMcpCount > 0) parts.push(`${source.unapprovedMcpCount} unapproved ${source.scope === "user" ? "global " : "local "}MCP${source.unapprovedMcpCount === 1 ? "" : "s"}`);
    if (source.unapprovedHookCount > 0) parts.push(`${source.unapprovedHookCount} unapproved hook${source.unapprovedHookCount === 1 ? "" : "s"}`);
    const names = report.detailsIncluded ? [...(source.mcpIds ?? []), ...(source.hookEvents ?? []).map((e) => `hook:${e}`)] : [];
    c.add({
      code: source.scope === "user" ? "USER_SCOPE_SHADOWING" : "LOCAL_SCOPE_SHADOWING",
      section: "security",
      componentId: source.scope === "user" ? "user-scope" : "local-scope",
      file: source.source,
      message: `${parts.join(" and ")} detected in ${source.source}${names.length ? ` (${names.join(", ")})` : ""}`,
      defaultSeverity: "warning",
      policy: "user_scope_shadowing",
      remediation: "Approve them via user_scope.allow_mcp in harnesslock.yaml, or disable them for this project",
    });
  }
  if (!flagged) c.ok("security", "user-scope", "no unapproved global MCPs or hooks");
}

/** Structural comparison of expected state (harnesslock.yaml + harnesslock.lock) against the actual workspace. */
export function computeDrift(input: DriftInput): DriftResult {
  const c = new Collector();
  checkLock(input, c);
  checkAgents(input, c);
  checkInstructions(input, c);
  if (input.lock || input.scan.mcps.length > 0) checkMcp(input, c);
  checkSkills(input, c);
  checkHooks(input, c);
  checkRules(input, c);
  checkPermissions(input, c);
  checkShadowing(input, c);
  return { events: c.events, components: c.components };
}

// ---------------------------------------------------------------------------------------------
// Line diff (LCS) used by `harnesslock diff` for instruction files.
// ---------------------------------------------------------------------------------------------

export interface DiffLine {
  op: " " | "+" | "-";
  text: string;
}

export function lineDiff(a: string, b: string): DiffLine[] {
  const left = a.replace(/\r\n?/g, "\n").split("\n");
  const right = b.replace(/\r\n?/g, "\n").split("\n");
  const n = left.length;
  const m = right.length;
  if (n * m > 4_000_000) {
    return [...left.map((text) => ({ op: "-" as const, text })), ...right.map((text) => ({ op: "+" as const, text }))];
  }
  const width = m + 1;
  const table = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i * width + j] =
        left[i] === right[j]
          ? (table[(i + 1) * width + j + 1] ?? 0) + 1
          : Math.max(table[(i + 1) * width + j] ?? 0, table[i * width + j + 1] ?? 0);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (left[i] === right[j]) {
      out.push({ op: " ", text: left[i] ?? "" });
      i++;
      j++;
    } else if ((table[(i + 1) * width + j] ?? 0) >= (table[i * width + j + 1] ?? 0)) {
      out.push({ op: "-", text: left[i++] ?? "" });
    } else {
      out.push({ op: "+", text: right[j++] ?? "" });
    }
  }
  while (i < n) out.push({ op: "-", text: left[i++] ?? "" });
  while (j < m) out.push({ op: "+", text: right[j++] ?? "" });
  return out;
}

/** Renders a unified diff with `context` lines around each change. Returns "" when identical. */
export function formatUnifiedDiff(aName: string, bName: string, a: string, b: string, context = 3): string {
  const lines = lineDiff(a, b);
  if (lines.every((l) => l.op === " ")) return "";
  const out = [`--- ${aName}`, `+++ ${bName}`];
  let idx = 0;
  while (idx < lines.length) {
    while (idx < lines.length && lines[idx]?.op === " ") idx++;
    if (idx >= lines.length) break;
    const start = Math.max(0, idx - context);
    let end = idx;
    let lastChange = idx;
    while (end < lines.length) {
      if (lines[end]?.op !== " ") lastChange = end;
      else if (end - lastChange > context * 2) break;
      end++;
    }
    end = Math.min(lines.length, lastChange + context + 1);
    let oldStart = 1;
    let newStart = 1;
    for (let k = 0; k < start; k++) {
      if (lines[k]?.op !== "+") oldStart++;
      if (lines[k]?.op !== "-") newStart++;
    }
    const hunk = lines.slice(start, end);
    const oldCount = hunk.filter((l) => l.op !== "+").length;
    const newCount = hunk.filter((l) => l.op !== "-").length;
    out.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`);
    for (const line of hunk) out.push(`${line.op}${line.text}`);
    idx = end;
  }
  return out.join("\n");
}
