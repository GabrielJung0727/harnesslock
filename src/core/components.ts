import type { ResolvedConfig, ResolvedMcpConfig } from "../schema/config-schema.js";
import type { AgentId, HookComponent, SkillComponent } from "../types/model.js";
import { fingerprint } from "./canonical.js";
import { uniqueSorted } from "./fs-utils.js";

/**
 * Stable keys for skills and hooks shared by `lock` and `verify`, so both sides of a comparison
 * name components identically.
 */

export interface KeyedSkill {
  id: string;
  declared: boolean;
  skill: SkillComponent;
}

/** Declared skills (matched by path) take their `harnesslock.yaml` name; others use their directory name. */
export function keySkills(skills: readonly SkillComponent[], config: ResolvedConfig): Map<string, KeyedSkill> {
  const out = new Map<string, KeyedSkill>();
  const declaredByPath = new Map(Object.entries(config.skills).map(([name, entry]) => [entry.path, name]));
  const sorted = [...skills].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  for (const skill of sorted) {
    const declaredName = declaredByPath.get(skill.path);
    if (declaredName) out.set(declaredName, { id: declaredName, declared: true, skill });
  }
  for (const skill of sorted) {
    if (declaredByPath.has(skill.path)) continue;
    let id = skill.id;
    if (out.has(id)) id = `${skill.agent}/${skill.id}`;
    let n = 2;
    while (out.has(id)) id = `${skill.agent}/${skill.id}#${n++}`;
    out.set(id, { id, declared: false, skill });
  }
  return out;
}

export interface KeyedHook {
  id: string;
  declared: boolean;
  event: string;
  agent: AgentId;
  files: string[];
  members: HookComponent[];
  fingerprint: string;
}

function hookMatches(hook: HookComponent, decl: ResolvedConfig["hooks"][string]): boolean {
  if (hook.event !== decl.event) return false;
  if (decl.agent && hook.agent !== decl.agent) return false;
  if (decl.match && !hook.command.includes(decl.match) && hook.matcher !== decl.match) return false;
  return true;
}

/** Declared hooks group every project hook matching their event/agent/match; the rest are keyed individually. */
export function keyHooks(hooks: readonly HookComponent[], config: ResolvedConfig): Map<string, KeyedHook> {
  const out = new Map<string, KeyedHook>();
  const project = hooks.filter((h) => h.scope === "project");
  const claimed = new Set<HookComponent>();
  for (const name of Object.keys(config.hooks).sort()) {
    const decl = config.hooks[name] as ResolvedConfig["hooks"][string];
    const members = project.filter((h) => hookMatches(h, decl));
    if (members.length === 0) continue;
    members.forEach((m) => claimed.add(m));
    out.set(name, {
      id: name,
      declared: true,
      event: decl.event,
      agent: decl.agent ?? (members[0] as HookComponent).agent,
      files: uniqueSorted(members.map((m) => m.file)),
      members,
      fingerprint: fingerprint(members.map((m) => m.fingerprint).sort()),
    });
  }
  for (const hook of project) {
    if (claimed.has(hook)) continue;
    out.set(hook.id, {
      id: hook.id,
      declared: false,
      event: hook.event,
      agent: hook.agent,
      files: [hook.file],
      members: [hook],
      fingerprint: fingerprint([hook.fingerprint]),
    });
  }
  return out;
}

/** Glob match where `*` matches any run of characters (`admin:*`, `mcp__github__*`). */
export function matchesPattern(pattern: string, value: string): boolean {
  if (!pattern.includes("*")) return pattern === value;
  const regex = new RegExp(`^${pattern.split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`);
  return regex.test(value);
}

export type PermissionVerdict = "ok" | "denied" | "unexpected";

/**
 * A permission is denied if it matches a `deny` pattern, unexpected if an `allow` list exists and it
 * matches none of it, and otherwise judged against the set recorded in the lockfile.
 */
export function evaluatePermission(
  permission: string,
  policy: ResolvedMcpConfig["permissions"] | undefined,
  lockedAllowed: readonly string[] | undefined,
): PermissionVerdict {
  if (policy?.deny.some((pattern) => matchesPattern(pattern, permission))) return "denied";
  if (policy?.allow !== undefined) return policy.allow.some((pattern) => matchesPattern(pattern, permission)) ? "ok" : "unexpected";
  if (lockedAllowed === undefined) return "ok";
  return lockedAllowed.includes(permission) ? "ok" : "unexpected";
}
