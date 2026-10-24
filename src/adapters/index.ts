import { fingerprint } from "../core/canonical.js";
import { uniqueSorted } from "../core/fs-utils.js";
import { resolveCachedVersion } from "../core/static-resolver.js";
import type { DetectOptions } from "../core/agent-detector.js";
import type { AgentDetection, AgentId, MCPComponent, McpDefinition, WorkspaceScan } from "../types/model.js";
import type { AgentAdapter, ScanContext, ScopeSource } from "./base.js";
import { ClaudeAdapter } from "./claude.js";
import { CodexAdapter } from "./codex.js";
import { CursorAdapter } from "./cursor.js";

export type { AgentAdapter, McpEdit, ScanContext, ScopeSource } from "./base.js";
export { ClaudeAdapter, CodexAdapter, CursorAdapter };

export const ADAPTERS: readonly AgentAdapter[] = [new ClaudeAdapter(), new CodexAdapter(), new CursorAdapter()];

export function getAdapter(id: AgentId): AgentAdapter {
  const adapter = ADAPTERS.find((a) => a.id === id);
  if (!adapter) throw new Error(`No adapter registered for agent "${id}"`);
  return adapter;
}

function mergeDefinitions(id: string, definitions: McpDefinition[]): MCPComponent {
  const sorted = [...definitions].sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
  const first = sorted[0] as McpDefinition;
  const requiredEnv: MCPComponent["requiredEnv"] = {};
  for (const def of sorted) Object.assign(requiredEnv, def.env);
  return {
    id,
    definedIn: uniqueSorted(sorted.map((d) => d.file)),
    sourceType: first.sourceType,
    packageName: first.packageName,
    declaredVersion: first.declaredVersion,
    isPinned: sorted.every((d) => d.isPinned),
    command: first.command,
    args: first.args,
    requiredEnv: Object.fromEntries(Object.keys(requiredEnv).sort().map((k) => [k, requiredEnv[k] as MCPComponent["requiredEnv"][string]])),
    permissions: uniqueSorted(sorted.flatMap((d) => d.permissions)),
    fingerprint: fingerprint(Object.fromEntries(sorted.map((d) => [d.file, d.fingerprint]))),
    definitions: sorted,
  };
}

export interface ScanOptions {
  /** Inspect node_modules / npx / uv caches for unpinned packages (default true). */
  resolveCache?: boolean;
}

/** Runs every adapter over the project (committed files only) and merges components. */
export async function scanWorkspace(ctx: ScanContext, options: ScanOptions = {}): Promise<WorkspaceScan> {
  const agents = await Promise.all(ADAPTERS.map((adapter) => adapter.scanProject(ctx)));

  const byId = new Map<string, McpDefinition[]>();
  for (const def of agents.flatMap((a) => a.mcps)) {
    const list = byId.get(def.id) ?? [];
    list.push(def);
    byId.set(def.id, list);
  }
  const mcps = [...byId.keys()].sort().map((id) => mergeDefinitions(id, byId.get(id) ?? []));

  if (options.resolveCache !== false) {
    const cache = new Map<string, Awaited<ReturnType<typeof resolveCachedVersion>>>();
    for (const component of mcps) {
      if (!component.packageName) continue;
      const key = `${component.sourceType}:${component.packageName}`;
      if (!cache.has(key)) {
        cache.set(
          key,
          await resolveCachedVersion(component.sourceType, component.packageName, ctx.root, ctx.homeDir, {
            env: ctx.env,
            platform: ctx.platform,
          }),
        );
      }
      const resolved = cache.get(key);
      if (resolved) {
        component.resolvedCacheVersion = resolved.version;
        component.resolvedCacheSource = resolved.source;
      }
    }
  }

  return {
    root: ctx.root,
    agents,
    mcps,
    skills: agents.flatMap((a) => a.skills),
    hooks: agents.flatMap((a) => a.hooks),
    rules: agents.flatMap((a) => a.rules),
    permissions: agents.flatMap((a) => (a.permissions ? [a.permissions] : [])),
    instructionFiles: uniqueSorted(agents.flatMap((a) => a.instructionFiles)),
    parseErrors: agents.flatMap((a) => a.parseErrors),
  };
}

/** User-scope (`~/...`) and project-local (gitignored) configuration sources, for shadowing detection. */
export async function scanScopes(ctx: ScanContext): Promise<ScopeSource[]> {
  return (await Promise.all(ADAPTERS.map((adapter) => adapter.scanScopes(ctx)))).flat();
}

export async function detectAgents(ctx: ScanContext, options: DetectOptions = {}): Promise<AgentDetection[]> {
  return Promise.all(ADAPTERS.map((adapter) => adapter.detect(ctx, options)));
}
