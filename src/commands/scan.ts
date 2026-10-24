import { detectAgents, scanWorkspace } from "../adapters/index.js";
import { resolveConfig } from "../schema/config-schema.js";
import { detectShadowing } from "../core/shadowing.js";
import { createPalette, header } from "../reporter/tui.js";
import { AGENT_LABELS, type AgentDetection, type ShadowingReport, type WorkspaceScan } from "../types/model.js";
import { loadProject, type CommandContext } from "./context.js";

export interface ScanOptions {
  json?: boolean;
  includeUser?: boolean;
  checkBinaries?: boolean;
}

export interface ScanOutput {
  scan: WorkspaceScan;
  agents: AgentDetection[];
  shadowing: ShadowingReport;
}

export async function collectScan(ctx: CommandContext, options: ScanOptions = {}): Promise<ScanOutput> {
  const scan = await scanWorkspace(ctx);
  const agents = await detectAgents(ctx, { checkBinaries: options.checkBinaries });
  // Shadowing is computed against harnesslock.yaml when present, otherwise against an empty policy.
  let config = resolveConfig({ version: 1 });
  try {
    config = (await loadProject(ctx)).config;
  } catch {
    // no (valid) harnesslock.yaml yet: every user-scope server counts as unapproved
  }
  const shadowing = await detectShadowing(ctx, config, { includeUser: options.includeUser });
  return { scan, agents, shadowing };
}

export async function runScan(ctx: CommandContext, options: ScanOptions = {}): Promise<number> {
  const result = await collectScan(ctx, options);
  if (options.json) {
    ctx.stdout(`${JSON.stringify(result, (key, value) => (key === "root" ? "." : value), 2)}\n`);
    return 0;
  }
  const p = createPalette(ctx.color);
  const out = [header(p, "Static Scan"), ""];
  for (const agentScan of result.scan.agents) {
    const detection = result.agents.find((a) => a.agent === agentScan.agent);
    const status = detection?.installed
      ? p.ok(`installed${detection.version ? ` ${detection.version}` : ""}`)
      : p.dim("not detected on this machine");
    out.push(`${p.bold(AGENT_LABELS[agentScan.agent])}  ${status}`);
    const files = [...agentScan.instructionFiles, ...agentScan.configFilesFound];
    out.push(`  ${p.dim("files:")}       ${files.length ? files.join(", ") : p.dim("none")}`);
    for (const mcp of agentScan.mcps) {
      const version = mcp.packageName ? `${mcp.packageName}${mcp.declaredVersion ? `@${mcp.declaredVersion}` : ""}` : (mcp.url ?? mcp.command);
      const pin = mcp.isPinned ? p.ok("pinned") : p.warn("unpinned");
      out.push(`  ${p.dim("mcp:")}         ${mcp.id}  ${p.dim(`${mcp.sourceType}`)} ${version} (${pin}) ${p.dim(mcp.file)}`);
    }
    for (const skill of agentScan.skills) out.push(`  ${p.dim("skill:")}       ${skill.id}  ${p.dim(`${skill.path} · ${skill.filesCount} files`)}`);
    for (const hook of agentScan.hooks) out.push(`  ${p.dim("hook:")}        ${hook.event}${hook.matcher ? ` [${hook.matcher}]` : ""}  ${p.dim(hook.command)}`);
    for (const rule of agentScan.rules) out.push(`  ${p.dim("rule:")}        ${rule.path}`);
    if (agentScan.permissions) {
      out.push(`  ${p.dim("permissions:")} allow ${agentScan.permissions.allow.length} · deny ${agentScan.permissions.deny.length} · ask ${agentScan.permissions.ask.length}`);
    }
    for (const issue of agentScan.parseErrors) out.push(`  ${p.error("✕")} ${issue.file}: ${issue.message}`);
    out.push("");
  }
  const unresolved = result.scan.mcps.filter((m) => !m.isPinned && m.packageName);
  if (unresolved.length) {
    out.push(p.bold("Static version resolution"));
    for (const mcp of unresolved) {
      out.push(`  ${mcp.id}: ${mcp.resolvedCacheVersion ? `${mcp.resolvedCacheVersion} ${p.dim(`(${mcp.resolvedCacheSource})`)}` : p.dim("not found in node_modules or local caches")}`);
    }
    out.push("");
  }
  out.push(p.bold("User scope"));
  const flagged = result.shadowing.sources.filter((s) => s.unapprovedMcpCount + s.unapprovedHookCount > 0);
  if (flagged.length === 0) out.push(`  ${p.ok("✓")} no unapproved global MCP servers or hooks`);
  for (const source of flagged) {
    const names = result.shadowing.detailsIncluded ? ` (${[...(source.mcpIds ?? []), ...(source.hookEvents ?? []).map((e) => `hook:${e}`)].join(", ")})` : "";
    out.push(`  ${p.warn("⚠")} ${source.source}: ${source.unapprovedMcpCount} MCP, ${source.unapprovedHookCount} hooks${names}`);
  }
  if (flagged.length && !result.shadowing.detailsIncluded) out.push(p.dim("    names hidden for privacy — pass --include-user to list them"));
  ctx.stdout(`${out.join("\n")}\n`);
  return 0;
}
