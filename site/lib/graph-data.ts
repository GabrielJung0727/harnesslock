export type NodeGroup = "lock" | "agent" | "instruction" | "mcp" | "skill" | "hook" | "policy" | "scope";

export interface GraphNode {
  id: string;
  label: string;
  group: NodeGroup;
  val: number;
  /** Where this component is defined. */
  source: string;
  /** What harnesslock.lock records about it. */
  locked: string;
  /** Present when the "simulate drift" toggle is on. */
  drift?: { severity: "error" | "warning"; code: string; message: string };
}

export interface GraphLink {
  source: string;
  target: string;
  /** Edge that turns red when drift is simulated. */
  drifts?: boolean;
}

export const GROUP_META: Record<NodeGroup, { label: string; color: string }> = {
  lock: { label: "Lockfile", color: "#e2e8f0" },
  agent: { label: "Agent", color: "#6366f1" },
  instruction: { label: "Instruction", color: "#38bdf8" },
  mcp: { label: "MCP server", color: "#10b981" },
  skill: { label: "Skill", color: "#f59e0b" },
  hook: { label: "Hook", color: "#fb923c" },
  policy: { label: "Policy", color: "#ef4444" },
  scope: { label: "User scope", color: "#a855f7" },
};

/** The example repository from the README, as harnesslock sees it. */
export const GRAPH: { nodes: GraphNode[]; links: GraphLink[] } = {
  nodes: [
    { id: "lock", label: "harnesslock.lock", group: "lock", val: 30, source: "harnesslock.lock", locked: "specHash sha256:4a8b9c2d… · 1 lockfile for 3 agents" },
    { id: "claude", label: "Claude Code", group: "agent", val: 20, source: ".claude/settings.json, .mcp.json", locked: "presence: if_installed · requested >=2.8.0 <3.0.0" },
    { id: "codex", label: "Codex", group: "agent", val: 20, source: ".codex/config.toml", locked: "presence: if_installed · requested ^0.150.0" },
    { id: "cursor", label: "Cursor", group: "agent", val: 20, source: ".cursor/mcp.json, .cursor/rules/", locked: "presence: if_installed · requested >=1.0.0" },
    { id: "claude-md", label: "CLAUDE.md", group: "instruction", val: 10, source: "CLAUDE.md", locked: "sync group core-agent-instructions · canonical sha256:73fa2b11…" },
    {
      id: "agents-md",
      label: "AGENTS.md",
      group: "instruction",
      val: 10,
      source: "AGENTS.md",
      locked: "sync group core-agent-instructions · canonical sha256:73fa2b11…",
      drift: { severity: "error", code: "CROSS_AGENT_INSTRUCTION_DESYNC", message: "CLAUDE.md != AGENTS.md (AGENTS.md is newer). Codex and Cursor now follow different rules than Claude Code." },
    },
    {
      id: "mcp-github",
      label: "github MCP 1.4.7",
      group: "mcp",
      val: 16,
      source: ".mcp.json, .codex/config.toml, .cursor/mcp.json",
      locked: "@modelcontextprotocol/server-github · resolved 1.4.7 · GITHUB_TOKEN: excluded",
      drift: { severity: "error", code: "MCP_UNPINNED", message: "expected 1.4.7 (pinned) · actual: unversioned in .cursor/mcp.json (cached: 1.6.1)" },
    },
    { id: "mcp-postgres", label: "postgres MCP 0.6.2", group: "mcp", val: 14, source: ".mcp.json, .cursor/mcp.json", locked: "@modelcontextprotocol/server-postgres · resolved 0.6.2" },
    { id: "skill-fe", label: "frontend-review", group: "skill", val: 10, source: ".agents/skills/frontend-review", locked: "3 files · sha256:aa281c34…" },
    { id: "hook-lint", label: "pre-tool-lint", group: "hook", val: 10, source: ".claude/settings.json → .claude/hooks/lint.js", locked: "PreToolUse · command + script sha256:7120df99…" },
    { id: "perm-allow", label: "repo:read · pull_request:*", group: "policy", val: 9, source: "harnesslock.yaml", locked: "allowed permissions for github" },
    {
      id: "perm-deny",
      label: "repository:delete: DENY",
      group: "policy",
      val: 12,
      source: "harnesslock.yaml",
      locked: "deny repository:delete, admin:*",
      drift: { severity: "error", code: "UNEXPECTED_PERMISSION", message: "repository:delete was granted to github in .cursor/mcp.json. sync removes it." },
    },
    {
      id: "user-scope",
      label: "~/.cursor/mcp.json",
      group: "scope",
      val: 9,
      source: "developer home directory (never committed)",
      locked: "not locked — only counted against user_scope.allow_mcp",
      drift: { severity: "warning", code: "USER_SCOPE_SHADOWING", message: "1 unapproved global MCP detected. Its name stays hidden unless --include-user is passed." },
    },
  ],
  links: [
    { source: "lock", target: "claude" },
    { source: "lock", target: "codex" },
    { source: "lock", target: "cursor" },
    { source: "claude", target: "claude-md" },
    { source: "codex", target: "agents-md" },
    { source: "cursor", target: "agents-md" },
    { source: "claude-md", target: "agents-md", drifts: true },
    { source: "claude", target: "mcp-github" },
    { source: "codex", target: "mcp-github" },
    { source: "cursor", target: "mcp-github", drifts: true },
    { source: "claude", target: "mcp-postgres" },
    { source: "cursor", target: "mcp-postgres" },
    { source: "codex", target: "skill-fe" },
    { source: "claude", target: "hook-lint" },
    { source: "mcp-github", target: "perm-allow" },
    { source: "mcp-github", target: "perm-deny", drifts: true },
    { source: "cursor", target: "user-scope", drifts: true },
  ],
};
