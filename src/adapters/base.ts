import { promises as fs } from "node:fs";
import path from "node:path";
import type { DetectOptions } from "../core/agent-detector.js";
import { fingerprint, hashFileContent, sha256, canonicalize, shortHash } from "../core/canonical.js";
import {
  formatJsonLike,
  isFile,
  isInside,
  isRecord,
  listDir,
  parseJsonLoose,
  readBufferIfExists,
  readTextIfExists,
  relPosix,
  toPosix,
  uniqueSorted,
  walkFiles,
} from "../core/fs-utils.js";
import { envFingerprintMaterial, redactArgs, redactEnv, redactHeaders, redactString } from "../core/redactor.js";
import { commandBaseName, parseMcpCommand, type ParsedMcpCommand } from "../core/static-resolver.js";
import type {
  AgentDetection,
  AgentId,
  AgentPermissionSet,
  AgentScanResult,
  ConfigScope,
  HookComponent,
  McpDefinition,
  RuleComponent,
  SkillComponent,
} from "../types/model.js";

export interface ScanContext {
  root: string;
  homeDir: string;
  env: Record<string, string | undefined>;
  platform: NodeJS.Platform;
}

/** Non-shared configuration found outside the committed project files (user home or gitignored local files). */
export interface ScopeSource {
  source: string;
  scope: "user" | "local";
  agent: AgentId;
  mcpIds: string[];
  hookEvents: string[];
}

export interface McpEdit {
  id: string;
  /** Replace `args[index]` with `value`. */
  pinSpec?: { index: number; value: string };
  /** Permissions to remove from the server entry. */
  removePermissions?: string[];
}

/** Contract every agent adapter implements. Adapters only read files; they never execute anything. */
export interface AgentAdapter {
  readonly id: AgentId;
  readonly label: string;
  /** Project paths this adapter inspects (for `doctor` / docs). */
  readonly projectPaths: readonly string[];
  /** User-scope paths inspected for shadowing (display form). */
  readonly userPaths: readonly string[];
  scanProject(ctx: ScanContext): Promise<AgentScanResult>;
  scanScopes(ctx: ScanContext): Promise<ScopeSource[]>;
  detect(ctx: ScanContext, options?: DetectOptions): Promise<AgentDetection>;
  /** Applies MCP edits to one project config file. Returns true if the file changed. */
  applyMcpEdits(ctx: ScanContext, file: string, edits: readonly McpEdit[]): Promise<boolean>;
}

export function emptyScan(agent: AgentId): AgentScanResult {
  return {
    agent,
    configFilesFound: [],
    instructionFiles: [],
    mcps: [],
    skills: [],
    hooks: [],
    rules: [],
    parseErrors: [],
  };
}

export function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

const SCRIPT_EXTENSIONS = /\.(m?js|cjs|ts|mts|py|sh|bash|ps1|rb|go|php|pl)$/i;

/** Hashes repository files referenced by a command line (local MCP servers, hook scripts). */
export async function hashReferencedFiles(root: string, tokens: readonly string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const rawToken of tokens) {
    const token = rawToken
      .replace(/\$\{?(CLAUDE_PROJECT_DIR|CURSOR_PROJECT_DIR|PWD)\}?/g, ".")
      .replace(/^["']|["']$/g, "");
    if (token === "" || token.startsWith("-") || /^[a-z]+:\/\//i.test(token)) continue;
    if (!token.includes("/") && !token.includes("\\") && !SCRIPT_EXTENSIONS.test(token)) continue;
    const abs = path.resolve(root, token);
    if (!isInside(root, abs) || !(await isFile(abs))) continue;
    const content = await readBufferIfExists(abs, 5 * 1024 * 1024);
    if (content) out[relPosix(root, abs)] = hashFileContent(content);
  }
  return out;
}

function splitCommandLine(command: string): string[] {
  const tokens: string[] = [];
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(command)) !== null) tokens.push(match[1] ?? match[2] ?? match[3] ?? "");
  return tokens;
}

export interface McpDefinitionInput {
  id: string;
  agent: AgentId;
  file: string;
  scope: ConfigScope;
  entry: unknown;
}

/** Normalizes one MCP server entry (Claude/Cursor JSON or Codex TOML shape) into a redacted definition. */
export async function buildMcpDefinition(ctx: ScanContext, input: McpDefinitionInput): Promise<McpDefinition> {
  const entry = isRecord(input.entry) ? input.entry : {};
  const command = typeof entry.command === "string" ? entry.command : "";
  const rawArgs = Array.isArray(entry.args) ? entry.args.map((a) => String(a)) : [];
  const url =
    typeof entry.url === "string" ? entry.url : typeof entry.serverUrl === "string" ? entry.serverUrl : undefined;

  const parsed: ParsedMcpCommand =
    command === "" && url !== undefined
      ? { sourceType: "http", isPinned: true, normalizedArgs: [] }
      : parseMcpCommand(command, rawArgs);

  const envRaw = isRecord(entry.env) ? entry.env : {};
  const headers = isRecord(entry.headers) ? entry.headers : isRecord(entry.http_headers) ? entry.http_headers : {};
  const permissions = uniqueSorted(stringArray(entry.permissions));
  const enabled = entry.disabled !== true && entry.enabled !== false;
  const localFiles = parsed.sourceType === "local" ? await hashReferencedFiles(ctx.root, [command, ...rawArgs]) : {};

  const material = {
    sourceType: parsed.sourceType,
    runner: parsed.runner,
    packageName: parsed.packageName,
    command: command === "" ? undefined : commandBaseName(command),
    args: redactArgs(parsed.normalizedArgs),
    url: url === undefined ? undefined : redactString(url),
    transport: typeof entry.type === "string" ? entry.type : undefined,
    env: envFingerprintMaterial(envRaw),
    envVars: stringArray(entry.env_vars).sort(),
    bearerTokenEnvVar: typeof entry.bearer_token_env_var === "string" ? entry.bearer_token_env_var : undefined,
    headers: redactHeaders(headers),
    cwd: typeof entry.cwd === "string" ? toPosix(entry.cwd) : undefined,
    enabled,
    localFiles,
  };

  return {
    id: input.id,
    agent: input.agent,
    file: input.file,
    scope: input.scope,
    sourceType: parsed.sourceType,
    runner: parsed.runner,
    packageName: parsed.packageName,
    declaredVersion: parsed.declaredVersion,
    isPinned: parsed.isPinned,
    command: redactString(command),
    args: redactArgs(rawArgs),
    url: url === undefined ? undefined : redactString(url),
    env: redactEnv({ ...envRaw, ...Object.fromEntries(stringArray(entry.env_vars).map((k) => [k, ""])) }),
    permissions,
    enabled,
    specLocation: parsed.specLocation,
    specExtras: parsed.specExtras,
    fingerprint: fingerprint(material),
  };
}

export async function buildMcpDefinitions(
  ctx: ScanContext,
  agent: AgentId,
  file: string,
  scope: ConfigScope,
  servers: unknown,
): Promise<McpDefinition[]> {
  if (!isRecord(servers)) return [];
  const out: McpDefinition[] = [];
  for (const id of Object.keys(servers).sort()) {
    out.push(await buildMcpDefinition(ctx, { id, agent, file, scope, entry: servers[id] }));
  }
  return out;
}

export function enabledServerIds(servers: unknown): string[] {
  if (!isRecord(servers)) return [];
  return Object.entries(servers)
    .filter(([, entry]) => !(isRecord(entry) && (entry.disabled === true || entry.enabled === false)))
    .map(([id]) => id)
    .sort();
}

interface RawHook {
  event: string;
  matcher?: string;
  type: string;
  command: string;
}

/**
 * Flattens hook declarations. Supports Claude Code's
 * `{ Event: [{ matcher, hooks: [{ type, command }] }] }` and Cursor's `{ event: [{ command }] }`.
 */
export function flattenHooks(hooks: unknown): RawHook[] {
  if (!isRecord(hooks)) return [];
  const out: RawHook[] = [];
  for (const event of Object.keys(hooks).sort()) {
    const entries = hooks[event];
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (!isRecord(entry)) continue;
      const matcher = typeof entry.matcher === "string" ? entry.matcher : undefined;
      if (Array.isArray(entry.hooks)) {
        for (const hook of entry.hooks) {
          if (!isRecord(hook)) continue;
          const command = typeof hook.command === "string" ? hook.command : typeof hook.prompt === "string" ? hook.prompt : "";
          out.push({ event, matcher, type: typeof hook.type === "string" ? hook.type : "command", command });
        }
      } else if (typeof entry.command === "string") {
        out.push({ event, matcher, type: typeof entry.type === "string" ? entry.type : "command", command: entry.command });
      }
    }
  }
  return out;
}

export async function buildHookComponents(
  ctx: ScanContext,
  agent: AgentId,
  file: string,
  scope: ConfigScope,
  hooks: RawHook[],
): Promise<HookComponent[]> {
  const out: HookComponent[] = [];
  const seen = new Map<string, number>();
  for (const hook of hooks) {
    const scripts = await hashReferencedFiles(ctx.root, splitCommandLine(hook.command));
    const redactedCommand = redactString(hook.command);
    const material = { event: hook.event, matcher: hook.matcher, type: hook.type, command: redactedCommand, scripts };
    let id = `${agent}:${hook.event}:${shortHash(sha256(canonicalize({ matcher: hook.matcher, command: redactedCommand })))}`;
    const count = (seen.get(id) ?? 0) + 1;
    seen.set(id, count);
    if (count > 1) id = `${id}#${count}`;
    out.push({
      id,
      agent,
      file,
      scope,
      event: hook.event,
      matcher: hook.matcher,
      type: hook.type,
      command: redactedCommand,
      scripts: Object.keys(scripts).sort(),
      fingerprint: fingerprint(material),
    });
  }
  return out;
}

async function fingerprintFiles(files: string[], base: string): Promise<{ list: { path: string; sha256: string }[]; fp: string }> {
  const list: { path: string; sha256: string }[] = [];
  for (const abs of files) {
    const content = await readBufferIfExists(abs);
    if (!content) continue;
    list.push({ path: toPosix(path.relative(base, abs)), sha256: hashFileContent(content) });
  }
  list.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { list, fp: fingerprint(list) };
}

/** Each child directory (or standalone markdown file) of `relDir` is one skill. */
export async function scanSkillsDir(ctx: ScanContext, relDir: string, agent: AgentId): Promise<SkillComponent[]> {
  const dir = path.join(ctx.root, relDir);
  const out: SkillComponent[] = [];
  for (const entry of await listDir(dir)) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const files = await walkFiles(abs);
      const { list, fp } = await fingerprintFiles(files, abs);
      out.push({ id: entry.name, agent, path: relPosix(ctx.root, abs), filesCount: list.length, files: list, fingerprint: fp });
    } else if (entry.isFile() && /\.mdc?$/i.test(entry.name)) {
      const { list, fp } = await fingerprintFiles([abs], dir);
      out.push({
        id: entry.name.replace(/\.mdc?$/i, ""),
        agent,
        path: relPosix(ctx.root, abs),
        filesCount: list.length,
        files: list,
        fingerprint: fp,
      });
    }
  }
  return out;
}

export async function scanRuleFiles(ctx: ScanContext, relDir: string, agent: AgentId, extensions: RegExp): Promise<RuleComponent[]> {
  const files = await walkFiles(path.join(ctx.root, relDir));
  const out: RuleComponent[] = [];
  for (const abs of files) {
    if (!extensions.test(abs)) continue;
    const content = await readBufferIfExists(abs);
    if (!content) continue;
    const rel = relPosix(ctx.root, abs);
    out.push({ id: rel, agent, path: rel, fingerprint: hashFileContent(content) });
  }
  return out;
}

export function mergePermissions(agent: AgentId, parts: Array<Partial<Omit<AgentPermissionSet, "agent">>>): AgentPermissionSet | undefined {
  const sources = uniqueSorted(parts.flatMap((p) => p.sources ?? []));
  if (sources.length === 0) return undefined;
  return {
    agent,
    sources,
    allow: uniqueSorted(parts.flatMap((p) => p.allow ?? [])),
    deny: uniqueSorted(parts.flatMap((p) => p.deny ?? [])),
    ask: uniqueSorted(parts.flatMap((p) => p.ask ?? [])),
  };
}

/** Applies MCP edits to a JSON config with servers under `containerKey` (preserves indentation & EOL). */
export async function applyJsonMcpEdits(absPath: string, containerKey: string, edits: readonly McpEdit[]): Promise<boolean> {
  const text = await readTextIfExists(absPath);
  if (text === undefined) return false;
  const doc = parseJsonLoose(text);
  if (!isRecord(doc) || !isRecord(doc[containerKey])) return false;
  const servers = doc[containerKey] as Record<string, unknown>;
  let changed = false;
  for (const edit of edits) {
    const server = servers[edit.id];
    if (!isRecord(server)) continue;
    if (edit.pinSpec && Array.isArray(server.args) && server.args[edit.pinSpec.index] !== edit.pinSpec.value) {
      server.args[edit.pinSpec.index] = edit.pinSpec.value;
      changed = true;
    }
    if (edit.removePermissions?.length && Array.isArray(server.permissions)) {
      const current: unknown[] = server.permissions;
      const kept = current.filter((p) => !edit.removePermissions?.includes(String(p)));
      if (kept.length !== current.length) {
        server.permissions = kept;
        changed = true;
      }
    }
  }
  if (changed) await fs.writeFile(absPath, formatJsonLike(text, doc), "utf8");
  return changed;
}

/** Reads a JSON config, recording presence and parse errors on the scan result. */
export async function readProjectJson(ctx: ScanContext, result: AgentScanResult, relFile: string): Promise<Record<string, unknown> | undefined> {
  const text = await readTextIfExists(path.join(ctx.root, relFile));
  if (text === undefined) return undefined;
  result.configFilesFound.push(relFile);
  if (text.trim() === "") return {};
  try {
    const value = parseJsonLoose(text);
    if (!isRecord(value)) {
      result.parseErrors.push({ file: relFile, message: "expected a JSON object at the top level" });
      return undefined;
    }
    return value;
  } catch (error) {
    result.parseErrors.push({ file: relFile, message: (error as Error).message });
    return undefined;
  }
}

/** Reads a user-scope JSON file; failures are silently ignored (privacy: never report contents). */
export async function readUserJson(absPath: string): Promise<Record<string, unknown> | undefined> {
  const text = await readTextIfExists(absPath);
  if (text === undefined) return undefined;
  try {
    const value = parseJsonLoose(text);
    return isRecord(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

export function hookEventsOf(hooks: unknown): string[] {
  return flattenHooks(hooks).map((h) => h.event);
}

export async function existingFiles(root: string, candidates: readonly string[]): Promise<string[]> {
  const out: string[] = [];
  for (const rel of candidates) if (await isFile(path.join(root, rel))) out.push(rel);
  return out;
}
