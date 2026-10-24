import { promises as fs } from "node:fs";
import path from "node:path";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import { detectAgent, type DetectOptions } from "../core/agent-detector.js";
import { homeDisplay, isRecord, readTextIfExists, toPosix } from "../core/fs-utils.js";
import type { AgentDetection, AgentScanResult } from "../types/model.js";
import {
  buildHookComponents,
  buildMcpDefinitions,
  emptyScan,
  enabledServerIds,
  existingFiles,
  mergePermissions,
  scanSkillsDir,
  stringArray,
  type AgentAdapter,
  type McpEdit,
  type ScanContext,
  type ScopeSource,
} from "./base.js";

const CONFIG_FILE = ".codex/config.toml";

function codexPermissions(config: Record<string, unknown>) {
  const allow: string[] = [];
  if (typeof config.sandbox_mode === "string") allow.push(`sandbox_mode:${config.sandbox_mode}`);
  if (typeof config.approval_policy === "string") allow.push(`approval_policy:${config.approval_policy}`);
  const workspaceWrite = isRecord(config.sandbox_workspace_write) ? config.sandbox_workspace_write : undefined;
  if (workspaceWrite?.network_access === true) allow.push("network_access");
  for (const root of stringArray(workspaceWrite?.writable_roots)) allow.push(`writable_root:${toPosix(root)}`);
  return { sources: [CONFIG_FILE], allow, deny: [], ask: [] };
}

function tomlKeyPattern(id: string): string {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return `(?:${escaped}|"${escaped}"|'${escaped}')`;
}

function renderTomlArray(values: readonly string[]): string {
  return `[${values.map((v) => JSON.stringify(v)).join(", ")}]`;
}

/** Finds the line range `[start, end)` of `key = [ ... ]` (possibly multi-line) inside a section. */
function findArrayAssignment(lines: string[], from: number, to: number, key: string): { start: number; end: number; indent: string } | undefined {
  const keyPattern = new RegExp(`^(\\s*)${key}\\s*=\\s*\\[`);
  for (let i = from; i < to; i++) {
    const match = keyPattern.exec(lines[i] ?? "");
    if (!match) continue;
    let depth = 0;
    let inString: string | null = null;
    for (let j = i; j < to; j++) {
      const line = lines[j] ?? "";
      for (let k = 0; k < line.length; k++) {
        const ch = line[k];
        if (inString) {
          if (ch === "\\" && inString === '"') k++;
          else if (ch === inString) inString = null;
        } else if (ch === '"' || ch === "'") {
          inString = ch;
        } else if (ch === "#") {
          break;
        } else if (ch === "[") {
          depth++;
        } else if (ch === "]") {
          depth--;
          if (depth === 0) return { start: i, end: j + 1, indent: match[1] ?? "" };
        }
      }
    }
    return undefined;
  }
  return undefined;
}

/**
 * Edits `[mcp_servers.<id>]` in place, preserving comments and formatting elsewhere.
 * Returns undefined when the server is not declared as a standard table (caller falls back).
 */
export function editTomlMcpServer(text: string, id: string, update: { args?: string[]; permissions?: string[] }): string | undefined {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  const header = new RegExp(`^\\s*\\[\\s*mcp_servers\\s*\\.\\s*${tomlKeyPattern(id)}\\s*\\]\\s*(#.*)?$`);
  const start = lines.findIndex((line) => header.test(line));
  if (start < 0) return undefined;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\s*\[/.test(lines[i] ?? "")) {
      end = i;
      break;
    }
  }
  for (const [key, values] of [
    ["args", update.args],
    ["permissions", update.permissions],
  ] as const) {
    if (!values) continue;
    const range = findArrayAssignment(lines, start + 1, end, key);
    if (!range) return undefined;
    const replacement = `${range.indent}${key} = ${renderTomlArray(values)}`;
    const removed = range.end - range.start - 1;
    lines.splice(range.start, range.end - range.start, replacement);
    end -= removed;
  }
  return lines.join(eol);
}

/** OpenAI Codex: AGENTS.md, .codex/config.toml ([mcp_servers.*], sandbox/approval policy, notify), .agents/skills. */
export class CodexAdapter implements AgentAdapter {
  readonly id = "codex" as const;
  readonly label = "Codex";
  readonly projectPaths = ["AGENTS.md", ".codex/config.toml", ".agents/skills/", ".codex/skills/"] as const;
  readonly userPaths = ["~/.codex/config.toml"] as const;

  private async readToml(abs: string): Promise<{ ok: true; value: Record<string, unknown> } | { ok: false; error: string } | undefined> {
    const text = await readTextIfExists(abs);
    if (text === undefined) return undefined;
    try {
      return { ok: true, value: parseToml(text) as Record<string, unknown> };
    } catch (error) {
      return { ok: false, error: (error as Error).message };
    }
  }

  async scanProject(ctx: ScanContext): Promise<AgentScanResult> {
    const result = emptyScan(this.id);
    result.instructionFiles = await existingFiles(ctx.root, ["AGENTS.md", "AGENTS.override.md"]);

    const parsed = await this.readToml(path.join(ctx.root, CONFIG_FILE));
    if (parsed) {
      result.configFilesFound.push(CONFIG_FILE);
      if (!parsed.ok) {
        result.parseErrors.push({ file: CONFIG_FILE, message: parsed.error });
      } else {
        const config = parsed.value;
        result.mcps.push(...(await buildMcpDefinitions(ctx, this.id, CONFIG_FILE, "project", config.mcp_servers)));
        result.permissions = mergePermissions(this.id, [codexPermissions(config)]);
        const notify = stringArray(config.notify);
        if (notify.length > 0) {
          result.hooks.push(
            ...(await buildHookComponents(ctx, this.id, CONFIG_FILE, "project", [
              { event: "notify", type: "command", command: notify.map((part) => (/\s/.test(part) ? `"${part}"` : part)).join(" ") },
            ])),
          );
        }
      }
    }

    result.skills.push(...(await scanSkillsDir(ctx, ".agents/skills", this.id)));
    result.skills.push(...(await scanSkillsDir(ctx, ".codex/skills", this.id)));
    return result;
  }

  private userConfigPath(ctx: ScanContext): string {
    return path.join(ctx.env.CODEX_HOME ?? path.join(ctx.homeDir, ".codex"), "config.toml");
  }

  async scanScopes(ctx: ScanContext): Promise<ScopeSource[]> {
    const abs = this.userConfigPath(ctx);
    const parsed = await this.readToml(abs);
    if (!parsed?.ok) return [];
    const notify = stringArray(parsed.value.notify);
    return [
      {
        source: homeDisplay(abs, ctx.homeDir),
        scope: "user",
        agent: this.id,
        mcpIds: enabledServerIds(parsed.value.mcp_servers),
        hookEvents: notify.length > 0 ? ["notify"] : [],
      },
    ];
  }

  detect(ctx: ScanContext, options?: DetectOptions): Promise<AgentDetection> {
    return detectAgent(ctx, { agent: this.id, homeMarkers: [".codex"], binaries: ["codex"], npmPackage: "@openai/codex" }, options);
  }

  async applyMcpEdits(ctx: ScanContext, file: string, edits: readonly McpEdit[]): Promise<boolean> {
    if (file !== CONFIG_FILE) return false;
    const abs = path.join(ctx.root, file);
    const original = await readTextIfExists(abs);
    if (original === undefined) return false;
    const config = parseToml(original) as Record<string, unknown>;
    const servers = isRecord(config.mcp_servers) ? config.mcp_servers : {};

    let text = original;
    let structuredFallback = false;
    let changed = false;
    for (const edit of edits) {
      const server = servers[edit.id];
      if (!isRecord(server)) continue;
      const args = stringArray(server.args);
      const permissions = stringArray(server.permissions);
      let newArgs: string[] | undefined;
      let newPermissions: string[] | undefined;
      if (edit.pinSpec && args[edit.pinSpec.index] !== edit.pinSpec.value) {
        newArgs = [...args];
        newArgs[edit.pinSpec.index] = edit.pinSpec.value;
        server.args = newArgs;
      }
      if (edit.removePermissions?.length) {
        const filtered = permissions.filter((p) => !edit.removePermissions?.includes(p));
        if (filtered.length !== permissions.length) {
          newPermissions = filtered;
          server.permissions = filtered;
        }
      }
      if (!newArgs && !newPermissions) continue;
      changed = true;
      const edited = editTomlMcpServer(text, edit.id, { args: newArgs, permissions: newPermissions });
      if (edited === undefined) structuredFallback = true;
      else text = edited;
    }
    if (!changed) return false;
    // Inline-table layouts cannot be edited textually; re-serialize the whole document instead.
    const output = structuredFallback ? stringifyToml(config) + "\n" : text;
    await fs.writeFile(abs, output, "utf8");
    return true;
  }
}
