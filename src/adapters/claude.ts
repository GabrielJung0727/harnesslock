import path from "node:path";
import { detectAgent, type DetectOptions } from "../core/agent-detector.js";
import { homeDisplay, isRecord, toPosix } from "../core/fs-utils.js";
import type { AgentDetection, AgentScanResult } from "../types/model.js";
import {
  applyJsonMcpEdits,
  buildHookComponents,
  buildMcpDefinitions,
  emptyScan,
  enabledServerIds,
  existingFiles,
  flattenHooks,
  hookEventsOf,
  mergePermissions,
  readProjectJson,
  readUserJson,
  scanSkillsDir,
  stringArray,
  type AgentAdapter,
  type McpEdit,
  type ScanContext,
  type ScopeSource,
} from "./base.js";

const MCP_CONFIG_FILES = [".mcp.json", ".claude/settings.json"] as const;

function claudeSettingsPermissions(settings: Record<string, unknown>, source: string) {
  const permissions = isRecord(settings.permissions) ? settings.permissions : {};
  const allow = stringArray(permissions.allow);
  if (typeof permissions.defaultMode === "string") allow.push(`defaultMode:${permissions.defaultMode}`);
  for (const dir of stringArray(permissions.additionalDirectories)) allow.push(`additionalDirectory:${toPosix(dir)}`);
  if (settings.enableAllProjectMcpServers === true) allow.push("enableAllProjectMcpServers");
  return {
    sources: [source],
    allow,
    deny: stringArray(permissions.deny),
    ask: stringArray(permissions.ask),
  };
}

function normalizeProjectKey(p: string, platform: NodeJS.Platform): string {
  const posix = toPosix(path.resolve(p)).replace(/\/+$/, "");
  return platform === "win32" ? posix.toLowerCase() : posix;
}

/** Claude Code: CLAUDE.md, .mcp.json, .claude/settings(.local).json, .claude/skills, .claude/hooks. */
export class ClaudeAdapter implements AgentAdapter {
  readonly id = "claude-code" as const;
  readonly label = "Claude Code";
  readonly projectPaths = [
    "CLAUDE.md",
    ".claude/CLAUDE.md",
    ".mcp.json",
    ".claude/settings.json",
    ".claude/settings.local.json",
    ".claude/skills/",
    ".claude/hooks/",
  ] as const;
  readonly userPaths = ["~/.claude/settings.json", "~/.claude.json"] as const;

  async scanProject(ctx: ScanContext): Promise<AgentScanResult> {
    const result = emptyScan(this.id);
    result.instructionFiles = await existingFiles(ctx.root, ["CLAUDE.md", ".claude/CLAUDE.md"]);

    const mcpJson = await readProjectJson(ctx, result, ".mcp.json");
    if (mcpJson) result.mcps.push(...(await buildMcpDefinitions(ctx, this.id, ".mcp.json", "project", mcpJson.mcpServers)));

    const settingsFile = ".claude/settings.json";
    const settings = await readProjectJson(ctx, result, settingsFile);
    if (settings) {
      result.mcps.push(...(await buildMcpDefinitions(ctx, this.id, settingsFile, "project", settings.mcpServers)));
      result.hooks.push(...(await buildHookComponents(ctx, this.id, settingsFile, "project", flattenHooks(settings.hooks))));
      result.permissions = mergePermissions(this.id, [claudeSettingsPermissions(settings, settingsFile)]);
    }

    result.skills.push(...(await scanSkillsDir(ctx, ".claude/skills", this.id)));
    return result;
  }

  async scanScopes(ctx: ScanContext): Promise<ScopeSource[]> {
    const sources: ScopeSource[] = [];

    const localFile = ".claude/settings.local.json";
    const local = await readUserJson(path.join(ctx.root, localFile));
    if (local) {
      sources.push({
        source: localFile,
        scope: "local",
        agent: this.id,
        mcpIds: enabledServerIds(local.mcpServers),
        hookEvents: hookEventsOf(local.hooks),
      });
    }

    const userSettingsPath = path.join(ctx.homeDir, ".claude", "settings.json");
    const userSettings = await readUserJson(userSettingsPath);
    if (userSettings) {
      sources.push({
        source: homeDisplay(userSettingsPath, ctx.homeDir),
        scope: "user",
        agent: this.id,
        mcpIds: enabledServerIds(userSettings.mcpServers),
        hookEvents: hookEventsOf(userSettings.hooks),
      });
    }

    const claudeJsonPath = path.join(ctx.homeDir, ".claude.json");
    const claudeJson = await readUserJson(claudeJsonPath);
    if (claudeJson) {
      const ids = new Set(enabledServerIds(claudeJson.mcpServers));
      if (isRecord(claudeJson.projects)) {
        const rootKey = normalizeProjectKey(ctx.root, ctx.platform);
        for (const [projectPath, project] of Object.entries(claudeJson.projects)) {
          if (normalizeProjectKey(projectPath, ctx.platform) !== rootKey || !isRecord(project)) continue;
          for (const id of enabledServerIds(project.mcpServers)) ids.add(id);
        }
      }
      sources.push({
        source: homeDisplay(claudeJsonPath, ctx.homeDir),
        scope: "user",
        agent: this.id,
        mcpIds: [...ids].sort(),
        hookEvents: [],
      });
    }
    return sources;
  }

  detect(ctx: ScanContext, options?: DetectOptions): Promise<AgentDetection> {
    return detectAgent(
      ctx,
      {
        agent: this.id,
        homeMarkers: [".claude", ".claude.json"],
        binaries: ["claude"],
        npmPackage: "@anthropic-ai/claude-code",
        packageJsonPaths: [path.join(ctx.homeDir, ".claude", "local", "node_modules", "@anthropic-ai", "claude-code", "package.json")],
        versionDirs: [path.join(ctx.homeDir, ".local", "share", "claude", "versions")],
      },
      options,
    );
  }

  async applyMcpEdits(ctx: ScanContext, file: string, edits: readonly McpEdit[]): Promise<boolean> {
    if (!(MCP_CONFIG_FILES as readonly string[]).includes(file)) return false;
    return applyJsonMcpEdits(path.join(ctx.root, file), "mcpServers", edits);
  }
}
