import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ClaudeAdapter, CodexAdapter, CursorAdapter, detectAgents, scanWorkspace } from "../src/adapters/index.js";
import { editTomlMcpServer } from "../src/adapters/codex.js";
import { detectShadowing } from "../src/core/shadowing.js";
import { resolveConfig } from "../src/schema/config-schema.js";
import { createMultiAgentWorkspace, FAKE_TOKEN, GITHUB_PKG, makeSandbox, testContext, writeFiles, type Sandbox } from "./helpers.js";

describe("agent adapters", () => {
  let sandbox: Sandbox;
  beforeEach(async () => {
    sandbox = await makeSandbox();
    await createMultiAgentWorkspace(sandbox);
  });
  afterEach(async () => {
    await sandbox.cleanup();
  });

  it("ClaudeAdapter parses .mcp.json, settings permissions, hooks and hook scripts", async () => {
    const ctx = testContext(sandbox);
    const result = await new ClaudeAdapter().scanProject(ctx);
    expect(result.instructionFiles).toEqual(["CLAUDE.md"]);
    expect(result.configFilesFound).toEqual([".mcp.json", ".claude/settings.json"]);
    expect(result.mcps).toHaveLength(1);
    const github = result.mcps[0];
    expect(github).toMatchObject({ id: "github", file: ".mcp.json", sourceType: "npm", packageName: GITHUB_PKG, declaredVersion: "1.4.7", isPinned: true });
    expect(github?.env).toEqual({ GITHUB_TOKEN: { required: true, value: "excluded" } });
    expect(JSON.stringify(result)).not.toContain(FAKE_TOKEN);
    expect(result.permissions).toEqual({
      agent: "claude-code",
      sources: [".claude/settings.json"],
      allow: ["Bash(npm test)"],
      deny: ["Bash(rm -rf *)"],
      ask: [],
    });
    expect(result.hooks).toHaveLength(1);
    expect(result.hooks[0]).toMatchObject({ event: "PreToolUse", matcher: "Bash", scripts: [".claude/hooks/lint.js"] });
  });

  it("hook fingerprints cover the referenced script contents", async () => {
    const ctx = testContext(sandbox);
    const before = (await new ClaudeAdapter().scanProject(ctx)).hooks[0]?.fingerprint;
    await writeFiles(sandbox.root, { ".claude/hooks/lint.js": "require('child_process');\n" });
    const after = (await new ClaudeAdapter().scanProject(ctx)).hooks[0]?.fingerprint;
    expect(before).toBeDefined();
    expect(after).not.toBe(before);
  });

  it("CodexAdapter parses TOML mcp_servers, policy and skills", async () => {
    const ctx = testContext(sandbox);
    const result = await new CodexAdapter().scanProject(ctx);
    expect(result.configFilesFound).toEqual([".codex/config.toml"]);
    expect(result.mcps[0]).toMatchObject({ id: "github", file: ".codex/config.toml", declaredVersion: "1.4.7", isPinned: true });
    expect(result.permissions?.allow).toEqual(["approval_policy:on-request"]);
    expect(result.skills).toHaveLength(1);
    expect(result.skills[0]).toMatchObject({ id: "frontend-review", path: ".agents/skills/frontend-review", filesCount: 2 });
  });

  it("CursorAdapter parses mcp.json and hashes rule files", async () => {
    const ctx = testContext(sandbox);
    const result = await new CursorAdapter().scanProject(ctx);
    expect(result.mcps[0]).toMatchObject({ id: "github", file: ".cursor/mcp.json", permissions: ["pull_request:read", "repo:read"] });
    expect(result.rules).toEqual([expect.objectContaining({ id: ".cursor/rules/style.mdc", agent: "cursor" })]);
    expect(result.rules[0]?.fingerprint).toMatch(/^sha256:/);
  });

  it("merges the same MCP server across agents and keeps fingerprints key-order independent", async () => {
    const ctx = testContext(sandbox);
    const scan = await scanWorkspace(ctx);
    expect(scan.mcps).toHaveLength(1);
    const github = scan.mcps[0];
    expect(github?.definedIn).toEqual([".codex/config.toml", ".cursor/mcp.json", ".mcp.json"]);
    expect(github?.resolvedCacheVersion).toBe("1.6.1");
    const fp = github?.definitions.find((d) => d.file === ".cursor/mcp.json")?.fingerprint;
    await writeFiles(sandbox.root, {
      ".cursor/mcp.json": JSON.stringify({
        mcpServers: { github: { permissions: ["repo:read", "pull_request:read"], env: { GITHUB_TOKEN: "ghp_differentsecretvalue000000" }, args: ["-y", `${GITHUB_PKG}@1.4.7`], command: "npx" } },
      }),
    });
    const again = await scanWorkspace(ctx);
    expect(again.mcps[0]?.definitions.find((d) => d.file === ".cursor/mcp.json")?.fingerprint).toBe(fp);
  });

  it("records parse errors instead of crashing", async () => {
    await writeFiles(sandbox.root, { ".cursor/mcp.json": "{ broken", ".codex/config.toml": "[mcp_servers.x\n" });
    const scan = await scanWorkspace(testContext(sandbox));
    expect(scan.parseErrors.map((e) => e.file).sort()).toEqual([".codex/config.toml", ".cursor/mcp.json"]);
  });

  it("accepts JSONC (comments, trailing commas) in Cursor configs", async () => {
    await writeFiles(sandbox.root, {
      ".cursor/mcp.json": '{\n  // project servers\n  "mcpServers": { "github": { "command": "npx", "args": ["-y", "x@1.0.0",], }, },\n}\n',
    });
    const result = await new CursorAdapter().scanProject(testContext(sandbox));
    expect(result.parseErrors).toEqual([]);
    expect(result.mcps[0]).toMatchObject({ packageName: "x", isPinned: true });
  });

  it("detects agents only from static evidence", async () => {
    const detections = await detectAgents(testContext(sandbox));
    expect(detections.find((d) => d.agent === "claude-code")).toMatchObject({ installed: true, evidence: ["~/.claude"] });
    expect(detections.find((d) => d.agent === "codex")?.installed).toBe(false);
    expect(detections.find((d) => d.agent === "cursor")?.installed).toBe(false);
  });

  it("reads agent versions from npm global package metadata next to the binary on PATH", async () => {
    const bin = path.join(sandbox.base, "global");
    const isWin = process.platform === "win32";
    await writeFiles(bin, {
      [isWin ? "codex.cmd" : "codex"]: "#!/bin/sh\n",
      [isWin ? "node_modules/@openai/codex/package.json" : "../lib/node_modules/@openai/codex/package.json"]: JSON.stringify({
        name: "@openai/codex",
        version: "0.150.2",
      }),
    });
    const ctx = { ...testContext(sandbox), env: { PATH: bin, PATHEXT: ".CMD" } };
    const codex = (await detectAgents(ctx)).find((d) => d.agent === "codex");
    expect(codex).toMatchObject({ installed: true, version: "0.150.2", versionSource: "package metadata" });
  });
});

describe("user-scope shadowing", () => {
  let sandbox: Sandbox;
  beforeEach(async () => {
    sandbox = await makeSandbox();
    await writeFiles(sandbox.home, {
      ".cursor/mcp.json": JSON.stringify({ mcpServers: { "personal-db": { command: "node", args: ["/secret/path/db.js", "--password=hunter2"] }, github: { command: "npx" } } }),
      ".claude/settings.json": JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: "say done" }] }] } }),
      ".codex/config.toml": '[mcp_servers.notes]\ncommand = "notes-mcp"\n[mcp_servers.off]\ncommand = "x"\nenabled = false\n',
    });
    await writeFiles(sandbox.root, {
      ".claude/settings.local.json": JSON.stringify({ mcpServers: { scratch: { command: "node", args: ["s.js"] } } }),
    });
  });
  afterEach(async () => {
    await sandbox.cleanup();
  });

  const config = resolveConfig({ version: 1, mcp: { github: { source: { type: "npm", package: GITHUB_PKG } } } });

  it("reports only counts and source paths by default", async () => {
    const report = await detectShadowing(testContext(sandbox), config);
    expect(report.totalUnapprovedMcp).toBe(3);
    expect(report.totalUnapprovedHooks).toBe(1);
    const cursor = report.sources.find((s) => s.source === "~/.cursor/mcp.json");
    expect(cursor).toEqual({ source: "~/.cursor/mcp.json", scope: "user", agent: "cursor", unapprovedMcpCount: 1, unapprovedHookCount: 0 });
    const serialized = JSON.stringify(report);
    for (const leaked of ["personal-db", "hunter2", "/secret/path", "notes", "say done", "scratch"]) expect(serialized).not.toContain(leaked);
    expect(report.sources.find((s) => s.scope === "local")).toMatchObject({ source: ".claude/settings.local.json", unapprovedMcpCount: 1 });
  });

  it("lists names only with includeUser, and honours allow lists", async () => {
    const detailed = await detectShadowing(testContext(sandbox), config, { includeUser: true });
    expect(detailed.sources.find((s) => s.source === "~/.cursor/mcp.json")?.mcpIds).toEqual(["personal-db"]);
    const allowing = resolveConfig({ version: 1, mcp: { github: {} }, user_scope: { allow_mcp: ["personal-db", "notes", "scratch"], allow_hooks: true } });
    const report = await detectShadowing(testContext(sandbox), allowing);
    expect(report.totalUnapprovedMcp).toBe(0);
    expect(report.totalUnapprovedHooks).toBe(0);
  });
});

describe("TOML editing", () => {
  it("rewrites only the targeted server, preserving comments and multi-line arrays", () => {
    const text = [
      "# top comment",
      "[mcp_servers.github]",
      'command = "npx" # runner',
      "args = [",
      '  "-y",',
      '  "@modelcontextprotocol/server-github",',
      "]",
      'permissions = ["repo:read", "repository:delete"]',
      "",
      "[mcp_servers.other]",
      'args = ["keep"]',
      "",
    ].join("\n");
    const edited = editTomlMcpServer(text, "github", { args: ["-y", "@modelcontextprotocol/server-github@1.4.7"], permissions: ["repo:read"] });
    expect(edited).toBe(
      [
        "# top comment",
        "[mcp_servers.github]",
        'command = "npx" # runner',
        'args = ["-y", "@modelcontextprotocol/server-github@1.4.7"]',
        'permissions = ["repo:read"]',
        "",
        "[mcp_servers.other]",
        'args = ["keep"]',
        "",
      ].join("\n"),
    );
    expect(editTomlMcpServer(text, "missing", { args: [] })).toBeUndefined();
  });
});
