import { promises as fs } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installGitHooks, HOOK_MARKER_START } from "../src/commands/hooks.js";
import { runInit } from "../src/commands/init.js";
import { runLock } from "../src/commands/lock.js";
import { runSync, syncWorkspace } from "../src/commands/sync.js";
import { verifyWorkspace } from "../src/commands/verify.js";
import { canonicalizeInstruction } from "../src/core/canonical.js";
import {
  CLAUDE_MD,
  createMultiAgentWorkspace,
  GITHUB_PKG,
  makeSandbox,
  readFile,
  testContext,
  updateJson,
  writeFiles,
  type Sandbox,
} from "./helpers.js";

describe("sync remediation", () => {
  let sandbox: Sandbox;
  beforeEach(async () => {
    sandbox = await makeSandbox();
    await createMultiAgentWorkspace(sandbox);
    const ctx = testContext(sandbox);
    await runInit(ctx);
    await runLock(ctx);
    await updateJson(sandbox.root, ".cursor/mcp.json", (doc) => {
      doc.mcpServers.github.args = ["-y", GITHUB_PKG];
      doc.mcpServers.github.permissions.push("repository:delete");
    });
    await writeFiles(sandbox.root, { "AGENTS.md": "# Project rules\n\nUse npm for every install.\n" });
    await writeFiles(sandbox.home, { ".cursor/mcp.json": JSON.stringify({ mcpServers: { "personal-db": { command: "node" } } }) });
  });
  afterEach(async () => {
    await sandbox.cleanup();
  });

  it("sync --pin pins versions, drops unauthorized permissions, syncs instructions, then verify passes", async () => {
    expect((await verifyWorkspace(testContext(sandbox))).report.summary.errors).toBe(3);

    const ctx = testContext(sandbox);
    const code = await runSync(ctx, { pin: true });
    expect(ctx.output()).toContain(`Updated .cursor/mcp.json: pinned ${GITHUB_PKG} to 1.4.7`);
    expect(ctx.output()).toContain("Updated .cursor/mcp.json: removed unauthorized permission 'repository:delete'");
    expect(ctx.output()).toContain("Synced AGENTS.md <- CLAUDE.md (core-agent-instructions)");
    expect(ctx.output()).toContain("Local agent configuration is now 100% synced with harnesslock.lock!");
    expect(code).toBe(0);

    const cursor = JSON.parse(await readFile(sandbox.root, ".cursor/mcp.json"));
    expect(cursor.mcpServers.github.args).toEqual(["-y", `${GITHUB_PKG}@1.4.7`]);
    expect(cursor.mcpServers.github.permissions).toEqual(["pull_request:read", "repo:read"]);
    expect(canonicalizeInstruction(await readFile(sandbox.root, "AGENTS.md"))).toBe(canonicalizeInstruction(CLAUDE_MD));

    const { report } = await verifyWorkspace(testContext(sandbox));
    expect(report.summary.errors).toBe(0);
    expect(report.exitCode).toBe(0);
    // The personal global MCP is reported, never silently "fixed".
    expect(report.events.map((e) => e.code)).toEqual(["USER_SCOPE_SHADOWING"]);
  });

  it("plain sync re-pins mismatched versions but leaves unpinned servers and instructions to --pin", async () => {
    await updateJson(sandbox.root, ".mcp.json", (doc) => {
      doc.mcpServers.github.args = ["-y", `${GITHUB_PKG}@1.6.1`];
    });
    const { actions, report } = await syncWorkspace(testContext(sandbox));
    expect(actions.map((a) => `${a.kind}:${a.file}`)).toEqual(["permission:.cursor/mcp.json", "pin:.mcp.json"]);
    expect(JSON.parse(await readFile(sandbox.root, ".mcp.json")).mcpServers.github.args[1]).toBe(`${GITHUB_PKG}@1.4.7`);
    expect(report?.events.filter((e) => e.severity === "error").map((e) => e.code)).toEqual(["CROSS_AGENT_INSTRUCTION_DESYNC", "MCP_UNPINNED"]);
  });

  it("pins Codex TOML in place, preserving comments", async () => {
    const toml = await readFile(sandbox.root, ".codex/config.toml");
    await writeFiles(sandbox.root, { ".codex/config.toml": toml.replace(`${GITHUB_PKG}@1.4.7`, `${GITHUB_PKG}@latest`) });
    await syncWorkspace(testContext(sandbox), { pin: true });
    const after = await readFile(sandbox.root, ".codex/config.toml");
    expect(after).toBe(toml);
    expect(after).toContain("# Codex project configuration");
  });

  it("--dry-run reports actions without touching files", async () => {
    const before = await readFile(sandbox.root, ".cursor/mcp.json");
    const agentsBefore = await readFile(sandbox.root, "AGENTS.md");
    const { actions, report } = await syncWorkspace(testContext(sandbox), { pin: true, dryRun: true });
    expect(actions.map((a) => a.kind).sort()).toEqual(["instructions", "permission", "pin"]);
    expect(report).toBeUndefined();
    expect(await readFile(sandbox.root, ".cursor/mcp.json")).toBe(before);
    expect(await readFile(sandbox.root, "AGENTS.md")).toBe(agentsBefore);
  });

  it("refuses to sync against a stale lockfile", async () => {
    const yaml = await readFile(sandbox.root, "harnesslock.yaml");
    await writeFiles(sandbox.root, { "harnesslock.yaml": yaml.replace("rule_drift: warn", "rule_drift: error") });
    await expect(syncWorkspace(testContext(sandbox), { pin: true })).rejects.toMatchObject({ exitCode: 1 });
  });
});

describe("install-hooks", () => {
  let sandbox: Sandbox;
  beforeEach(async () => {
    sandbox = await makeSandbox();
    await fs.mkdir(path.join(sandbox.root, ".git", "hooks"), { recursive: true });
  });
  afterEach(async () => {
    await sandbox.cleanup();
  });

  it("creates executable hooks, appends to existing ones idempotently, and uninstalls cleanly", async () => {
    const hooksDir = path.join(sandbox.root, ".git", "hooks");
    await fs.writeFile(path.join(hooksDir, "pre-commit"), "#!/bin/sh\nnpm run lint\n", "utf8");

    const first = await installGitHooks(testContext(sandbox));
    expect(first.installed).toEqual([
      { hook: "post-checkout", action: "created" },
      { hook: "post-merge", action: "created" },
      { hook: "pre-commit", action: "updated" },
    ]);
    const preCommit = await fs.readFile(path.join(hooksDir, "pre-commit"), "utf8");
    expect(preCommit.startsWith("#!/bin/sh\nnpm run lint\n")).toBe(true);
    expect(preCommit).toContain("npx --no-install harnesslock verify --quiet || exit 1");
    expect(await fs.readFile(path.join(hooksDir, "post-merge"), "utf8")).toContain("npx --no-install harnesslock verify --quiet || true");
    if (process.platform !== "win32") {
      expect((await fs.stat(path.join(hooksDir, "post-checkout"))).mode & 0o777).toBe(0o755);
    }

    const second = await installGitHooks(testContext(sandbox));
    expect(second.installed.every((h) => h.action === "unchanged")).toBe(true);
    expect((await fs.readFile(path.join(hooksDir, "pre-commit"), "utf8")).split(HOOK_MARKER_START)).toHaveLength(2);

    await installGitHooks(testContext(sandbox), { uninstall: true });
    expect(await fs.readFile(path.join(hooksDir, "pre-commit"), "utf8")).toBe("#!/bin/sh\nnpm run lint\n");
    await expect(fs.stat(path.join(hooksDir, "post-merge"))).rejects.toThrow();
  });

  it("fails outside a git repository", async () => {
    await fs.rm(path.join(sandbox.root, ".git"), { recursive: true });
    await expect(installGitHooks(testContext(sandbox))).rejects.toMatchObject({ exitCode: 1 });
  });
});
