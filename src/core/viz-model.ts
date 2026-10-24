import type { ResolvedConfig } from "../schema/config-schema.js";
import type { HarnessLockFile } from "../schema/lock-schema.js";
import {
  AGENT_IDS,
  AGENT_LABELS,
  type AgentDetection,
  type AgentId,
  type DriftEvent,
  type Severity,
  type ShadowingReport,
  type VerificationReport,
  type WorkspaceScan,
} from "../types/model.js";
import { shortHash } from "./canonical.js";
import { keyHooks, keySkills } from "./components.js";

/**
 * Graph model behind `harnesslock viz`: every component HarnessLock knows about becomes a node,
 * and every finding from `verify` is attached to the node (and edge) it concerns.
 * Built only from already-redacted scan data, so it is safe to embed in a shareable HTML file.
 */

export type VizGroup = "lock" | "agent" | "instruction" | "mcp" | "permission" | "skill" | "hook" | "rule" | "scope";
export type VizStatus = "ok" | "warning" | "error" | "skipped";

export interface VizIssue {
  severity: Severity;
  code: string;
  message: string;
  expected?: string;
  actual?: string;
  remediation?: string;
}

export interface VizNode {
  id: string;
  label: string;
  group: VizGroup;
  status: VizStatus;
  size: number;
  /** Ordered key/value facts shown in the detail panel. */
  details: Array<[string, string]>;
  issues: VizIssue[];
}

export interface VizLink {
  source: string;
  target: string;
  kind: "uses" | "defines" | "sync" | "grants" | "shadows";
  status: VizStatus;
  label?: string;
}

export interface VizGraph {
  meta: {
    tool: "harnesslock";
    version: string;
    generatedAt: string;
    project: string;
    mode: "local" | "ci" | "scan-only";
    summary: { errors: number; warnings: number };
    note?: string;
  };
  nodes: VizNode[];
  links: VizLink[];
}

export interface VizInput {
  version: string;
  project: string;
  generatedAt: string;
  scan: WorkspaceScan;
  config: ResolvedConfig;
  lock?: HarnessLockFile;
  report?: VerificationReport;
  agents?: AgentDetection[];
  shadowing?: ShadowingReport;
  note?: string;
}

const SIZE: Record<VizGroup, number> = {
  lock: 26,
  agent: 18,
  mcp: 13,
  instruction: 10,
  skill: 9,
  hook: 9,
  scope: 9,
  rule: 7,
  permission: 6,
};

const INSTRUCTION_READERS: Record<string, AgentId[]> = {
  "CLAUDE.md": ["claude-code"],
  ".claude/CLAUDE.md": ["claude-code"],
  "AGENTS.md": ["codex", "cursor"],
  "AGENTS.override.md": ["codex"],
};

const RANK: Record<VizStatus, number> = { error: 3, warning: 2, ok: 1, skipped: 0 };

function worse(a: VizStatus, b: VizStatus): VizStatus {
  return RANK[a] >= RANK[b] ? a : b;
}

function statusOf(severity: Severity): VizStatus {
  return severity === "error" ? "error" : severity === "warning" ? "warning" : "ok";
}

const LOCK_ID = "lock";
const agentNode = (agent: AgentId) => `agent:${agent}`;
const mcpNode = (id: string) => `mcp:${id}`;
const permNode = (mcp: string, perm: string) => `perm:${mcp}:${perm}`;
const agentPermNode = (agent: AgentId) => `agentperm:${agent}`;
const instructionNode = (file: string) => `instr:${file}`;
const skillNode = (id: string) => `skill:${id}`;
const hookNode = (id: string) => `hook:${id}`;
const ruleNode = (path: string) => `rule:${path}`;
const scopeNode = (source: string) => `scope:${source}`;

class GraphBuilder {
  readonly nodes = new Map<string, VizNode>();
  readonly links = new Map<string, VizLink>();

  node(id: string, label: string, group: VizGroup, details: Array<[string, string | undefined]> = [], status: VizStatus = "ok"): VizNode {
    const existing = this.nodes.get(id);
    if (existing) return existing;
    const node: VizNode = {
      id,
      label,
      group,
      status,
      size: SIZE[group],
      details: details.filter((d): d is [string, string] => d[1] !== undefined && d[1] !== ""),
      issues: [],
    };
    this.nodes.set(id, node);
    return node;
  }

  link(source: string, target: string, kind: VizLink["kind"], label?: string): VizLink | undefined {
    if (!this.nodes.has(source) || !this.nodes.has(target)) return undefined;
    const key = `${source}->${target}`;
    const existing = this.links.get(key);
    if (existing) {
      if (label && existing.label && !existing.label.split(", ").includes(label)) existing.label = `${existing.label}, ${label}`;
      return existing;
    }
    const link: VizLink = { source, target, kind, status: "ok", label };
    this.links.set(key, link);
    return link;
  }

  flag(nodeId: string, event: DriftEvent): boolean {
    const node = this.nodes.get(nodeId);
    if (!node) return false;
    node.issues.push({
      severity: event.severity,
      code: event.code,
      message: event.message,
      expected: event.expected,
      actual: event.actual,
      remediation: event.remediation,
    });
    node.status = worse(node.status === "skipped" ? "ok" : node.status, statusOf(event.severity));
    return true;
  }

  flagLink(source: string, target: string, severity: Severity): void {
    const link = this.links.get(`${source}->${target}`) ?? this.links.get(`${target}->${source}`);
    if (link) link.status = worse(link.status, statusOf(severity));
  }
}

function agentsInUse(input: VizInput): AgentId[] {
  return AGENT_IDS.filter((agent) => {
    const scan = input.scan.agents.find((a) => a.agent === agent);
    const used =
      scan &&
      (scan.configFilesFound.length > 0 || scan.instructionFiles.length > 0 || scan.skills.length > 0 || scan.rules.length > 0);
    return used || input.config.agents[agent] !== undefined || input.agents?.find((d) => d.agent === agent)?.installed === true;
  });
}

export function buildVizGraph(input: VizInput): VizGraph {
  const g = new GraphBuilder();
  const { scan, config, lock } = input;

  g.node(LOCK_ID, lock ? "harnesslock.lock" : "workspace", "lock", [
    ["Lockfile", lock ? `generated ${lock.generatedAt}` : "not generated yet"],
    ["Spec hash", lock ? `sha256:${shortHash(lock.specHash, 12)}` : undefined],
    ["Instruction strategy", config.instructions.strategy],
  ]);

  // Agents
  for (const agent of agentsInUse(input)) {
    const detection = input.agents?.find((d) => d.agent === agent);
    const conf = config.agents[agent];
    const files = scan.agents.find((a) => a.agent === agent)?.configFilesFound ?? [];
    const installed = detection === undefined ? "not checked (repository mode)" : detection.installed ? `yes${detection.version ? ` · ${detection.version}` : ""}` : "no";
    g.node(
      agentNode(agent),
      AGENT_LABELS[agent],
      "agent",
      [
        ["Installed", installed],
        ["Presence", conf?.presence],
        ["Required version", conf?.version],
        ["Config files", files.join(", ") || "none"],
      ],
      detection && !detection.installed ? "skipped" : "ok",
    );
    g.link(LOCK_ID, agentNode(agent), "uses");
  }

  // Instructions
  const instructionFiles = new Set([...scan.instructionFiles, ...config.instructions.syncGroups.flatMap((s) => s.files)]);
  for (const file of [...instructionFiles].sort()) {
    const exists = scan.instructionFiles.includes(file);
    const groups = config.instructions.syncGroups.filter((s) => s.files.includes(file)).map((s) => s.name);
    g.node(
      instructionNode(file),
      file,
      "instruction",
      [
        ["Exists", exists ? "yes" : "no"],
        ["Sync groups", groups.join(", ") || undefined],
        ["Read by", (INSTRUCTION_READERS[file] ?? []).map((a) => AGENT_LABELS[a]).join(", ") || undefined],
      ],
      exists ? "ok" : "skipped",
    );
    for (const agent of INSTRUCTION_READERS[file] ?? []) g.link(agentNode(agent), instructionNode(file), "uses");
  }
  for (const group of config.instructions.syncGroups) {
    for (let i = 1; i < group.files.length; i++) {
      g.link(instructionNode(group.files[0] as string), instructionNode(group.files[i] as string), "sync", group.name);
    }
  }

  // MCP servers & their permissions
  for (const component of scan.mcps) {
    const locked = lock?.mcp[component.id];
    const declaredVersions = component.definitions.map((d) => `${d.file}: ${d.declaredVersion ?? "unversioned"}${d.isPinned ? "" : " (unpinned)"}`);
    g.node(mcpNode(component.id), component.id, "mcp", [
      ["Source", `${component.sourceType}${component.packageName ? ` · ${component.packageName}` : ""}`],
      ["Locked version", locked?.resolvedVersion],
      ["Declared", declaredVersions.join("\n")],
      ["Cached locally", component.resolvedCacheVersion ? `${component.resolvedCacheVersion} (${component.resolvedCacheSource})` : undefined],
      ["Environment", Object.keys(component.requiredEnv).map((k) => `${k} = excluded`).join(", ") || undefined],
      ["Declared in harnesslock.yaml", config.mcp[component.id] ? "yes" : "no"],
    ]);
    for (const def of component.definitions) g.link(agentNode(def.agent), mcpNode(component.id), "uses", def.file);
    for (const permission of component.permissions) {
      g.node(permNode(component.id, permission), permission, "permission", [
        ["Granted to", component.id],
        ["Granted in", component.definitions.filter((d) => d.permissions.includes(permission)).map((d) => d.file).join(", ")],
      ]);
      g.link(mcpNode(component.id), permNode(component.id, permission), "grants");
    }
  }

  // Agent-level permission rules
  for (const set of scan.permissions) {
    g.node(agentPermNode(set.agent), `${AGENT_LABELS[set.agent]} permissions`, "permission", [
      ["Allow", set.allow.join("\n") || "none"],
      ["Deny", set.deny.join("\n") || "none"],
      ["Ask", set.ask.join("\n") || undefined],
      ["Sources", set.sources.join(", ")],
    ]);
    g.link(agentNode(set.agent), agentPermNode(set.agent), "grants");
  }

  // Skills, hooks, rules
  for (const [id, keyed] of keySkills(scan.skills, config)) {
    g.node(skillNode(id), id, "skill", [
      ["Path", keyed.skill.path],
      ["Files", String(keyed.skill.filesCount)],
      ["Fingerprint", `sha256:${shortHash(keyed.skill.fingerprint, 12)}`],
      ["Declared", keyed.declared ? "yes" : "no"],
    ]);
    g.link(agentNode(keyed.skill.agent), skillNode(id), "defines");
  }
  for (const [id, keyed] of keyHooks(scan.hooks, config)) {
    const first = keyed.members[0];
    g.node(hookNode(id), keyed.declared ? id : `${keyed.event}${first?.matcher ? ` [${first.matcher}]` : ""}`, "hook", [
      ["Event", keyed.event],
      ["Command", keyed.members.map((m) => m.command).join("\n")],
      ["Scripts", keyed.members.flatMap((m) => m.scripts).join(", ") || undefined],
      ["Defined in", keyed.files.join(", ")],
    ]);
    g.link(agentNode(keyed.agent), hookNode(id), "defines");
  }
  for (const rule of scan.rules) {
    g.node(ruleNode(rule.path), rule.path.split("/").pop() ?? rule.path, "rule", [
      ["Path", rule.path],
      ["Fingerprint", `sha256:${shortHash(rule.fingerprint, 12)}`],
    ]);
    g.link(agentNode(rule.agent), ruleNode(rule.path), "defines");
  }

  // User / local scope (counts only unless --include-user)
  for (const source of input.shadowing?.sources ?? []) {
    const unapproved = source.unapprovedMcpCount + source.unapprovedHookCount;
    const details: Array<[string, string | undefined]> = [
      ["Scope", source.scope === "user" ? "user home (not committed)" : "project-local (gitignored)"],
      ["Unapproved MCP servers", String(source.unapprovedMcpCount)],
      ["Unapproved hooks", String(source.unapprovedHookCount)],
    ];
    if (input.shadowing?.detailsIncluded) {
      details.push(["Names", [...(source.mcpIds ?? []), ...(source.hookEvents ?? []).map((e) => `hook:${e}`)].join(", ") || undefined]);
    } else if (unapproved > 0) {
      details.push(["Names", "hidden for privacy (use --include-user)"]);
    }
    g.node(scopeNode(source.source), source.source, "scope", details);
    if (g.nodes.has(agentNode(source.agent))) g.link(agentNode(source.agent), scopeNode(source.source), "shadows");
    else {
      g.node(agentNode(source.agent), AGENT_LABELS[source.agent], "agent", [["Installed", "not part of this project"]], "skipped");
      g.link(agentNode(source.agent), scopeNode(source.source), "shadows");
    }
  }

  attachEvents(g, input);
  const order: Record<Severity, number> = { error: 0, warning: 1, info: 2 };
  for (const node of g.nodes.values()) node.issues.sort((a, b) => order[a.severity] - order[b.severity]);

  const errors = input.report?.summary.errors ?? 0;
  const warnings = input.report?.summary.warnings ?? 0;
  return {
    meta: {
      tool: "harnesslock",
      version: input.version,
      generatedAt: input.generatedAt,
      project: input.project,
      mode: input.report ? input.report.mode : "scan-only",
      summary: { errors, warnings },
      note: input.note,
    },
    nodes: [...g.nodes.values()],
    links: [...g.links.values()],
  };
}

function agentFromLabel(label: string): AgentId | undefined {
  return AGENT_IDS.find((a) => AGENT_LABELS[a] === label);
}

/** Attaches each verify finding to the node (and edge) it is about. Unmatched findings land on the lock node. */
function attachEvents(g: GraphBuilder, input: VizInput): void {
  const definitionAgent = new Map<string, AgentId>();
  for (const component of input.scan.mcps) {
    for (const def of component.definitions) definitionAgent.set(`${component.id}|${def.file}`, def.agent);
  }

  for (const event of input.report?.events ?? []) {
    let placed = false;
    switch (event.section) {
      case "agents": {
        const agent = agentFromLabel(event.componentId);
        placed = agent ? g.flag(agentNode(agent), event) : false;
        break;
      }
      case "instructions": {
        if (event.file && g.nodes.has(instructionNode(event.file))) {
          placed = g.flag(instructionNode(event.file), event);
        } else {
          placed = g.flag(instructionNode(event.componentId), event);
        }
        const group = input.config.instructions.syncGroups.find((s) => s.name === event.componentId);
        if (group) {
          const first = group.files[0] as string;
          for (const file of group.files.slice(1)) g.flagLink(instructionNode(first), instructionNode(file), event.severity);
          if (!placed && event.file) placed = g.flag(instructionNode(event.file), event);
        }
        break;
      }
      case "mcp": {
        placed = g.flag(mcpNode(event.componentId), event);
        const agent = event.file ? definitionAgent.get(`${event.componentId}|${event.file}`) : undefined;
        if (agent) g.flagLink(agentNode(agent), mcpNode(event.componentId), event.severity);
        break;
      }
      case "skills":
        placed = g.flag(skillNode(event.componentId), event);
        break;
      case "hooks":
        placed = g.flag(hookNode(event.componentId), event);
        break;
      case "rules":
        placed = g.flag(ruleNode(event.componentId), event);
        break;
      case "security": {
        if (event.code === "USER_SCOPE_SHADOWING" || event.code === "LOCAL_SCOPE_SHADOWING") {
          placed = event.file ? g.flag(scopeNode(event.file), event) : false;
          for (const link of g.links.values()) {
            if (link.target === scopeNode(event.file ?? "")) link.status = worse(link.status, statusOf(event.severity));
          }
          break;
        }
        const agent = agentFromLabel(event.componentId);
        if (agent) {
          placed = g.flag(agentPermNode(agent), event);
          break;
        }
        const permission = /permission: (.+)$/.exec(event.message)?.[1];
        if (permission && g.nodes.has(permNode(event.componentId, permission))) {
          placed = g.flag(permNode(event.componentId, permission), event);
          g.flagLink(mcpNode(event.componentId), permNode(event.componentId, permission), event.severity);
        } else {
          placed = g.flag(mcpNode(event.componentId), event);
        }
        break;
      }
      default:
        break;
    }
    if (!placed) g.flag(LOCK_ID, event);
  }
}
