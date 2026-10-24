import semver from "semver";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import {
  AGENT_IDS,
  isAgentId,
  type AgentId,
  type InstructionStrategy,
  type McpSourceType,
  type PolicyLevel,
  type PresencePolicy,
} from "../types/model.js";

const policyLevelSchema = z.enum(["error", "warn", "off"]);
const presenceSchema = z.enum(["required", "if_installed", "optional"]);
const strategySchema = z.enum(["cross-sync", "git-clean", "strict-hash"]);
const sourceTypeSchema = z.enum(["npm", "uvx", "docker", "local", "http"]);
const agentIdSchema = z.enum(AGENT_IDS as [AgentId, ...AgentId[]]);
const stringList = z.array(z.string().min(1));

const versionRange = z.string().refine((value) => semver.validRange(value) !== null, {
  message: "must be a valid semver version or range",
});

const agentEntrySchema = z.object({
  version: versionRange.optional(),
  presence: presenceSchema.optional(),
});

const mcpEntrySchema = z.object({
  source: z
    .object({
      type: sourceTypeSchema,
      package: z.string().min(1).optional(),
      image: z.string().min(1).optional(),
      url: z.string().min(1).optional(),
    })
    .optional(),
  version: z.string().min(1).optional(),
  require_pinned: z.boolean().optional(),
  required_env: stringList.optional(),
  permissions: z
    .object({
      allow: stringList.optional(),
      deny: stringList.optional(),
    })
    .optional(),
});

const policySchema = z.object({
  unknown_project_mcp: policyLevelSchema.optional(),
  unpinned_mcp_version: policyLevelSchema.optional(),
  mcp_drift: policyLevelSchema.optional(),
  user_scope_shadowing: policyLevelSchema.optional(),
  skill_drift: policyLevelSchema.optional(),
  hook_drift: policyLevelSchema.optional(),
  rule_drift: policyLevelSchema.optional(),
  unexpected_permissions: policyLevelSchema.optional(),
  instruction_drift: policyLevelSchema.optional(),
});

export const rawConfigSchema = z.strictObject({
  version: z.literal(1),
  agent_strategy: z
    .object({
      require_at_least_one: z.boolean().optional(),
      default_presence: presenceSchema.optional(),
    })
    .optional(),
  agents: z
    .record(z.string(), agentEntrySchema.nullable())
    .superRefine((agents, ctx) => {
      for (const key of Object.keys(agents)) {
        if (!isAgentId(key)) {
          ctx.addIssue({
            code: "custom",
            path: [key],
            message: `unknown agent "${key}" (expected one of ${AGENT_IDS.join(", ")})`,
          });
        }
      }
    })
    .optional(),
  instructions: z
    .object({
      strategy: strategySchema.optional(),
      sync_groups: z
        .array(
          z.object({
            name: z.string().min(1),
            files: z.array(z.string().min(1)).min(1),
            enforce_identical: z.boolean().optional(),
          }),
        )
        .optional(),
      files: stringList.optional(),
    })
    .optional(),
  mcp: z.record(z.string(), mcpEntrySchema.nullable()).optional(),
  skills: z
    .record(
      z.string(),
      z.object({
        path: z.string().min(1),
        required: z.boolean().optional(),
      }),
    )
    .optional(),
  hooks: z
    .record(
      z.string(),
      z.object({
        event: z.string().min(1),
        agent: agentIdSchema.optional(),
        match: z.string().min(1).optional(),
        required: z.boolean().optional(),
      }),
    )
    .optional(),
  policy: policySchema.optional(),
  user_scope: z
    .object({
      allow_mcp: stringList.optional(),
      allow_hooks: z.boolean().optional(),
    })
    .optional(),
});

export type RawConfig = z.infer<typeof rawConfigSchema>;

export interface ResolvedAgentConfig {
  version?: string;
  presence: PresencePolicy;
}

export interface ResolvedMcpConfig {
  source?: { type: McpSourceType; package?: string; image?: string; url?: string };
  version?: string;
  requirePinned: boolean;
  requiredEnv: string[];
  permissions?: { allow?: string[]; deny: string[] };
}

export interface ResolvedSyncGroup {
  name: string;
  files: string[];
  enforceIdentical: boolean;
}

export interface ResolvedPolicy {
  unknown_project_mcp: PolicyLevel;
  unpinned_mcp_version: PolicyLevel;
  mcp_drift: PolicyLevel;
  user_scope_shadowing: PolicyLevel;
  skill_drift: PolicyLevel;
  hook_drift: PolicyLevel;
  rule_drift: PolicyLevel;
  unexpected_permissions: PolicyLevel;
  instruction_drift: PolicyLevel;
}

export type PolicyKey = keyof ResolvedPolicy;

export const DEFAULT_POLICY: ResolvedPolicy = {
  unknown_project_mcp: "error",
  unpinned_mcp_version: "error",
  mcp_drift: "error",
  user_scope_shadowing: "warn",
  skill_drift: "error",
  hook_drift: "error",
  rule_drift: "warn",
  unexpected_permissions: "error",
  instruction_drift: "error",
};

export interface ResolvedConfig {
  version: 1;
  agentStrategy: { requireAtLeastOne: boolean; defaultPresence: PresencePolicy };
  agents: Partial<Record<AgentId, ResolvedAgentConfig>>;
  instructions: { strategy: InstructionStrategy; syncGroups: ResolvedSyncGroup[]; files: string[] };
  mcp: Record<string, ResolvedMcpConfig>;
  skills: Record<string, { path: string; required: boolean }>;
  hooks: Record<string, { event: string; agent?: AgentId; match?: string; required: boolean }>;
  policy: ResolvedPolicy;
  userScope: { allowMcp: string[]; allowHooks: boolean };
}

export class ConfigValidationError extends Error {
  constructor(
    readonly file: string,
    readonly issues: string[],
  ) {
    super(`${file} is invalid:\n${issues.map((issue) => `  - ${issue}`).join("\n")}`);
    this.name = "ConfigValidationError";
  }
}

function normalizeRelPath(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
}

export function resolveConfig(raw: RawConfig): ResolvedConfig {
  const defaultPresence = raw.agent_strategy?.default_presence ?? "if_installed";

  const agents: Partial<Record<AgentId, ResolvedAgentConfig>> = {};
  for (const [key, entry] of Object.entries(raw.agents ?? {})) {
    if (!isAgentId(key)) continue;
    agents[key] = { version: entry?.version, presence: entry?.presence ?? defaultPresence };
  }

  const mcp: Record<string, ResolvedMcpConfig> = {};
  for (const [id, entry] of Object.entries(raw.mcp ?? {})) {
    mcp[id] = {
      source: entry?.source,
      version: entry?.version,
      requirePinned: entry?.require_pinned ?? false,
      requiredEnv: [...(entry?.required_env ?? [])].sort(),
      permissions: entry?.permissions
        ? { allow: entry.permissions.allow, deny: entry.permissions.deny ?? [] }
        : undefined,
    };
  }

  const skills: ResolvedConfig["skills"] = {};
  for (const [name, entry] of Object.entries(raw.skills ?? {})) {
    skills[name] = { path: normalizeRelPath(entry.path), required: entry.required ?? false };
  }

  const hooks: ResolvedConfig["hooks"] = {};
  for (const [name, entry] of Object.entries(raw.hooks ?? {})) {
    hooks[name] = { event: entry.event, agent: entry.agent, match: entry.match, required: entry.required ?? false };
  }

  return {
    version: 1,
    agentStrategy: {
      requireAtLeastOne: raw.agent_strategy?.require_at_least_one ?? false,
      defaultPresence,
    },
    agents,
    instructions: {
      strategy: raw.instructions?.strategy ?? "cross-sync",
      syncGroups: (raw.instructions?.sync_groups ?? []).map((group) => ({
        name: group.name,
        files: group.files.map(normalizeRelPath),
        enforceIdentical: group.enforce_identical ?? true,
      })),
      files: (raw.instructions?.files ?? []).map(normalizeRelPath),
    },
    mcp,
    skills,
    hooks,
    policy: { ...DEFAULT_POLICY, ...stripUndefined(raw.policy ?? {}) },
    userScope: {
      allowMcp: raw.user_scope?.allow_mcp ?? [],
      allowHooks: raw.user_scope?.allow_hooks ?? false,
    },
  };
}

function stripUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}

export function formatZodIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const where = issue.path.length > 0 ? issue.path.map(String).join(".") : "(root)";
    return `${where}: ${issue.message}`;
  });
}

export interface ParsedConfig {
  /** The parsed YAML document (used for the lockfile `specHash`). */
  raw: unknown;
  config: ResolvedConfig;
}

export function parseConfigText(text: string, file = "harnesslock.yaml"): ParsedConfig {
  let raw: unknown;
  try {
    raw = parseYaml(text);
  } catch (error) {
    throw new ConfigValidationError(file, [`YAML syntax error: ${(error as Error).message}`]);
  }
  if (raw === null || typeof raw !== "object") {
    throw new ConfigValidationError(file, ["(root): expected a mapping with `version: 1`"]);
  }
  const result = rawConfigSchema.safeParse(raw);
  if (!result.success) {
    throw new ConfigValidationError(file, formatZodIssues(result.error));
  }
  return { raw, config: resolveConfig(result.data) };
}
