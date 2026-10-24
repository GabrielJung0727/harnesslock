import path from "node:path";
import { detectAgent, type DetectOptions } from "../core/agent-detector.js";
import { hashFileContent } from "../core/canonical.js";
import { homeDisplay, isRecord, readBufferIfExists } from "../core/fs-utils.js";
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
  scanRuleFiles,
  stringArray,
  type AgentAdapter,
  type McpEdit,
  type ScanContext,
  type ScopeSource,
} from "./base.js";

const MCP_FILE = ".cursor/mcp.json";
const HOOKS_FILE = ".cursor/hooks.json";
const CLI_FILE = ".cursor/cli.json";

function cursorAppPackageJsons(ctx: ScanContext): string[] {
  switch (ctx.platform) {
    case "win32":
      return ctx.env.LOCALAPPDATA ? [path.join(ctx.env.LOCALAPPDATA, "Programs", "cursor", "resources", "app", "package.json")] : [];
    case "darwin":
      return [
        "/Applications/Cursor.app/Contents/Resources/app/package.json",
        path.join(ctx.homeDir, "Applications", "Cursor.app", "Contents", "Resources", "app", "package.json"),
      ];
    default:
      return [
        "/opt/Cursor/resources/app/package.json",
        "/usr/share/cursor/resources/app/package.json",
        path.join(ctx.homeDir, ".local", "share", "cursor", "resources", "app", "package.json"),
      ];
  }
}

/** Cursor: AGENTS.md, .cursor/mcp.json, .cursor/rules/** (.mdc/.md), .cursorrules, .cursor/hooks.json, .cursor/cli.json. */
export class CursorAdapter implements AgentAdapter {
  readonly id = "cursor" as const;
  readonly label = "Cursor";
  readonly projectPaths = ["AGENTS.md", MCP_FILE, ".cursor/rules/", ".cursorrules", HOOKS_FILE, CLI_FILE] as const;
  readonly userPaths = ["~/.cursor/mcp.json", "~/.cursor/hooks.json"] as const;

  async scanProject(ctx: ScanContext): Promise<AgentScanResult> {
    const result = emptyScan(this.id);
    result.instructionFiles = await existingFiles(ctx.root, ["AGENTS.md"]);

    const mcp = await readProjectJson(ctx, result, MCP_FILE);
    if (mcp) result.mcps.push(...(await buildMcpDefinitions(ctx, this.id, MCP_FILE, "project", mcp.mcpServers)));

    const hooks = await readProjectJson(ctx, result, HOOKS_FILE);
    if (hooks) result.hooks.push(...(await buildHookComponents(ctx, this.id, HOOKS_FILE, "project", flattenHooks(hooks.hooks))));

    const cli = await readProjectJson(ctx, result, CLI_FILE);
    if (cli) {
      const permissions = isRecord(cli.permissions) ? cli.permissions : {};
      result.permissions = mergePermissions(this.id, [
        { sources: [CLI_FILE], allow: stringArray(permissions.allow), deny: stringArray(permissions.deny), ask: [] },
      ]);
    }

    result.rules.push(...(await scanRuleFiles(ctx, ".cursor/rules", this.id, /\.mdc?$/i)));
    const legacy = await readBufferIfExists(path.join(ctx.root, ".cursorrules"));
    if (legacy) result.rules.push({ id: ".cursorrules", agent: this.id, path: ".cursorrules", fingerprint: hashFileContent(legacy) });
    return result;
  }

  async scanScopes(ctx: ScanContext): Promise<ScopeSource[]> {
    const sources: ScopeSource[] = [];
    const mcpPath = path.join(ctx.homeDir, ".cursor", "mcp.json");
    const mcp = await readUserJson(mcpPath);
    if (mcp) {
      sources.push({
        source: homeDisplay(mcpPath, ctx.homeDir),
        scope: "user",
        agent: this.id,
        mcpIds: enabledServerIds(mcp.mcpServers),
        hookEvents: [],
      });
    }
    const hooksPath = path.join(ctx.homeDir, ".cursor", "hooks.json");
    const hooks = await readUserJson(hooksPath);
    if (hooks) {
      sources.push({
        source: homeDisplay(hooksPath, ctx.homeDir),
        scope: "user",
        agent: this.id,
        mcpIds: [],
        hookEvents: hookEventsOf(hooks.hooks),
      });
    }
    return sources;
  }

  detect(ctx: ScanContext, options?: DetectOptions): Promise<AgentDetection> {
    return detectAgent(
      ctx,
      {
        agent: this.id,
        homeMarkers: [".cursor"],
        binaries: ["cursor", "cursor-agent"],
        packageJsonPaths: cursorAppPackageJsons(ctx),
      },
      options,
    );
  }

  async applyMcpEdits(ctx: ScanContext, file: string, edits: readonly McpEdit[]): Promise<boolean> {
    if (file !== MCP_FILE) return false;
    return applyJsonMcpEdits(path.join(ctx.root, file), "mcpServers", edits);
  }
}
