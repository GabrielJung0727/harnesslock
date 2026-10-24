/**
 * Core internal representations shared by adapters, engines, commands and reporters.
 * Every structure here is safe to print: secret values never reach these types.
 */

export type AgentId = "claude-code" | "codex" | "cursor";

export const AGENT_IDS: readonly AgentId[] = ["claude-code", "codex", "cursor"];

export const AGENT_LABELS: Record<AgentId, string> = {
  "claude-code": "Claude Code",
  codex: "Codex",
  cursor: "Cursor",
};

export function isAgentId(value: string): value is AgentId {
  return (AGENT_IDS as readonly string[]).includes(value);
}

export type PresencePolicy = "required" | "if_installed" | "optional";

export type InstructionStrategy = "cross-sync" | "git-clean" | "strict-hash";

export type McpSourceType = "npm" | "uvx" | "docker" | "local" | "http";

/** Source types whose version can be pinned inside the launch command. */
export const VERSIONED_SOURCE_TYPES: readonly McpSourceType[] = ["npm", "uvx", "docker"];

export type ConfigScope = "project" | "local" | "user";

export type Severity = "error" | "warning" | "info";

export type PolicyLevel = "error" | "warn" | "off";

export interface RedactedEnvEntry {
  required: boolean;
  value: "excluded";
}

/** Where (inside the original `args` array) the package spec lives, so `sync --pin` can rewrite it. */
export interface PackageSpecLocation {
  index: number;
  /** Literal prefix kept when rewriting, e.g. `--package=` or `--from=`. */
  prefix: string;
}

/** A single MCP server entry as found in one configuration file. */
export interface McpDefinition {
  id: string;
  agent: AgentId;
  /** Workspace-relative POSIX path (project scope) or `~/...` display path (user scope). */
  file: string;
  scope: ConfigScope;
  sourceType: McpSourceType;
  runner?: string;
  packageName?: string;
  declaredVersion?: string;
  isPinned: boolean;
  /** Redacted command. */
  command: string;
  /** Redacted arguments. */
  args: string[];
  url?: string;
  env: Record<string, RedactedEnvEntry>;
  permissions: string[];
  enabled: boolean;
  specLocation?: PackageSpecLocation;
  /** Package spec extras (python `[extra]`) preserved when re-pinning. */
  specExtras?: string;
  fingerprint: string;
}

/** An MCP server merged across every project configuration file that defines it. */
export interface MCPComponent {
  id: string;
  definedIn: string[];
  sourceType: McpSourceType;
  packageName?: string;
  declaredVersion?: string;
  resolvedCacheVersion?: string;
  resolvedCacheSource?: string;
  isPinned: boolean;
  command: string;
  args: string[];
  requiredEnv: Record<string, RedactedEnvEntry>;
  permissions: string[];
  fingerprint: string;
  definitions: McpDefinition[];
}

export interface SkillFile {
  path: string;
  sha256: string;
}

export interface SkillComponent {
  id: string;
  agent: AgentId;
  /** Workspace-relative POSIX path of the skill directory (or single file). */
  path: string;
  filesCount: number;
  files: SkillFile[];
  fingerprint: string;
}

export interface HookComponent {
  id: string;
  agent: AgentId;
  file: string;
  scope: ConfigScope;
  event: string;
  matcher?: string;
  type: string;
  /** Redacted command line. */
  command: string;
  scripts: string[];
  fingerprint: string;
}

export interface RuleComponent {
  id: string;
  agent: AgentId;
  path: string;
  fingerprint: string;
}

export interface AgentPermissionSet {
  agent: AgentId;
  sources: string[];
  allow: string[];
  deny: string[];
  ask: string[];
}

export interface ParseIssue {
  file: string;
  message: string;
}

export interface AgentScanResult {
  agent: AgentId;
  configFilesFound: string[];
  instructionFiles: string[];
  mcps: McpDefinition[];
  skills: SkillComponent[];
  hooks: HookComponent[];
  rules: RuleComponent[];
  permissions?: AgentPermissionSet;
  parseErrors: ParseIssue[];
}

export interface WorkspaceScan {
  root: string;
  agents: AgentScanResult[];
  mcps: MCPComponent[];
  skills: SkillComponent[];
  hooks: HookComponent[];
  rules: RuleComponent[];
  permissions: AgentPermissionSet[];
  instructionFiles: string[];
  parseErrors: ParseIssue[];
}

export interface AgentDetection {
  agent: AgentId;
  installed: boolean;
  version?: string;
  versionSource?: string;
  evidence: string[];
}

export interface InstructionFileState {
  path: string;
  exists: boolean;
  hash?: string;
  mtimeMs?: number;
  symlinkTarget?: string;
}

export type InstructionGroupStatus = "synced" | "desynced" | "partial" | "missing";

export interface InstructionGroupResult {
  name: string;
  enforceIdentical: boolean;
  files: InstructionFileState[];
  status: InstructionGroupStatus;
  canonicalFingerprint?: string;
  newestFile?: string;
  message: string;
}

export type GitFileState = "clean" | "dirty" | "untracked" | "missing" | "no-repo";

export interface InstructionEvaluation {
  strategy: InstructionStrategy;
  groups: InstructionGroupResult[];
  /** strict-hash: current fingerprint per tracked file (undefined when missing). */
  fileHashes: Record<string, string | undefined>;
  /** git-clean: working tree state per tracked file. */
  gitStatus: Record<string, GitFileState>;
}

export interface ShadowingSource {
  source: string;
  scope: "user" | "local";
  agent: AgentId;
  unapprovedMcpCount: number;
  unapprovedHookCount: number;
  /** Only populated with `--include-user`. */
  mcpIds?: string[];
  hookEvents?: string[];
}

export interface ShadowingReport {
  totalUnapprovedMcp: number;
  totalUnapprovedHooks: number;
  sources: ShadowingSource[];
  detailsIncluded: boolean;
}

export type DriftCode =
  | "LOCK_MISSING"
  | "SPEC_HASH_MISMATCH"
  | "CONFIG_PARSE_ERROR"
  | "AGENT_NOT_INSTALLED"
  | "AGENT_VERSION_MISMATCH"
  | "NO_ACTIVE_AGENT"
  | "CROSS_AGENT_INSTRUCTION_DESYNC"
  | "INSTRUCTION_HASH_MISMATCH"
  | "INSTRUCTION_DIRTY"
  | "INSTRUCTION_UNTRACKED"
  | "INSTRUCTION_MISSING"
  | "MCP_UNKNOWN"
  | "MCP_NOT_LOCKED"
  | "MCP_REMOVED"
  | "MCP_UNPINNED"
  | "MCP_VERSION_DRIFT"
  | "MCP_VERSION_OUT_OF_RANGE"
  | "MCP_CONFIG_DRIFT"
  | "MCP_SOURCE_CHANGED"
  | "MCP_ENV_MISSING"
  | "MCP_DECLARED_NOT_CONFIGURED"
  | "SKILL_MISSING"
  | "SKILL_DRIFT"
  | "SKILL_ADDED"
  | "SKILL_REMOVED"
  | "HOOK_MISSING"
  | "HOOK_DRIFT"
  | "HOOK_ADDED"
  | "HOOK_REMOVED"
  | "RULE_DRIFT"
  | "RULE_ADDED"
  | "RULE_REMOVED"
  | "UNEXPECTED_PERMISSION"
  | "PERMISSION_GUARD_REMOVED"
  | "USER_SCOPE_SHADOWING"
  | "LOCAL_SCOPE_SHADOWING";

export type ReportSection = "lock" | "agents" | "instructions" | "mcp" | "skills" | "hooks" | "rules" | "security";

export const REPORT_SECTIONS: readonly ReportSection[] = [
  "lock",
  "agents",
  "instructions",
  "mcp",
  "skills",
  "hooks",
  "rules",
  "security",
];

export interface DriftEvent {
  code: DriftCode;
  severity: Severity;
  section: ReportSection;
  componentId: string;
  message: string;
  file?: string;
  line?: number;
  expected?: string;
  actual?: string;
  remediation?: string;
}

export interface ComponentStatus {
  section: ReportSection;
  id: string;
  state: "ok" | "skipped";
  detail: string;
}

export interface VerificationSummary {
  errors: number;
  warnings: number;
  infos: number;
}

export interface VerificationReport {
  tool: "harnesslock";
  version: string;
  mode: "local" | "ci";
  root: string;
  presenceStrategy: PresencePolicy;
  instructionStrategy: InstructionStrategy;
  components: ComponentStatus[];
  events: DriftEvent[];
  summary: VerificationSummary;
  durationMs: number;
  exitCode: 0 | 1 | 2;
}
