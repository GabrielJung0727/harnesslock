import { scanScopes, type ScanContext } from "../adapters/index.js";
import type { ResolvedConfig } from "../schema/config-schema.js";
import type { ShadowingReport, ShadowingSource } from "../types/model.js";

export interface ShadowingOptions {
  /** Include server names / hook events in the report. Off by default for privacy. */
  includeUser?: boolean;
}

/**
 * Privacy-preserving shadowing detection.
 *
 * Reads `~/.claude/settings.json`, `~/.claude.json`, `~/.codex/config.toml`, `~/.cursor/mcp.json`,
 * `~/.cursor/hooks.json` and the project-local `.claude/settings.local.json`, and compares the
 * MCP servers / hooks they enable against what `harnesslock.yaml` approves. By default only counts
 * and the source path are reported — never server names, commands, arguments or environment.
 */
export async function detectShadowing(ctx: ScanContext, config: ResolvedConfig, options: ShadowingOptions = {}): Promise<ShadowingReport> {
  const approved = new Set([...Object.keys(config.mcp), ...config.userScope.allowMcp]);
  const includeUser = options.includeUser === true;
  const sources: ShadowingSource[] = [];

  for (const scope of await scanScopes(ctx)) {
    const unapprovedMcp = scope.mcpIds.filter((id) => !approved.has(id));
    const unapprovedHooks = config.userScope.allowHooks ? [] : scope.hookEvents;
    const source: ShadowingSource = {
      source: scope.source,
      scope: scope.scope,
      agent: scope.agent,
      unapprovedMcpCount: unapprovedMcp.length,
      unapprovedHookCount: unapprovedHooks.length,
    };
    if (includeUser) {
      source.mcpIds = [...unapprovedMcp].sort();
      source.hookEvents = [...unapprovedHooks].sort();
    }
    sources.push(source);
  }

  return {
    totalUnapprovedMcp: sources.reduce((sum, s) => sum + s.unapprovedMcpCount, 0),
    totalUnapprovedHooks: sources.reduce((sum, s) => sum + s.unapprovedHookCount, 0),
    sources,
    detailsIncluded: includeUser,
  };
}
