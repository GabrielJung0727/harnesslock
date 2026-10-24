import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createContext, type CommandContext } from "../src/commands/context.js";

export const GITHUB_PKG = "@modelcontextprotocol/server-github";
export const FAKE_TOKEN = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";

export interface Sandbox {
  base: string;
  root: string;
  home: string;
  cleanup: () => Promise<void>;
}

export async function makeSandbox(): Promise<Sandbox> {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "harnesslock-test-"));
  const root = path.join(base, "repo");
  const home = path.join(base, "home");
  await fs.mkdir(root, { recursive: true });
  await fs.mkdir(home, { recursive: true });
  return { base, root, home, cleanup: () => fs.rm(base, { recursive: true, force: true }) };
}

export async function writeFiles(base: string, files: Record<string, string>): Promise<void> {
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(base, rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content, "utf8");
  }
}

export async function readFile(base: string, rel: string): Promise<string> {
  return fs.readFile(path.join(base, rel), "utf8");
}

export interface TestContext extends CommandContext {
  output: () => string;
  errors: () => string;
}

/** Deterministic context: isolated home, empty PATH, no colors, captured output. */
export function testContext(sandbox: Sandbox): TestContext {
  let out = "";
  let err = "";
  const ctx = createContext({
    root: sandbox.root,
    homeDir: sandbox.home,
    env: { PATH: "" },
    stdout: (text) => {
      out += text;
    },
    stderr: (text) => {
      err += text;
    },
    color: false,
  });
  return Object.assign(ctx, { output: () => out, errors: () => err });
}

export function npxCachePackage(version: string, hash = "a1b2c3d4e5f6"): Record<string, string> {
  return {
    [`.npm/_npx/${hash}/node_modules/${GITHUB_PKG}/package.json`]: JSON.stringify({ name: GITHUB_PKG, version }),
  };
}

export const CLAUDE_MD = "# Project rules\n\n<!-- maintained by the platform team -->\nUse pnpm for every install.\nAlways run the tests before committing.\n";
/** Same canonical content as CLAUDE_MD: CRLF endings, trailing whitespace, no HTML comment. */
export const AGENTS_MD = "# Project rules  \r\n\r\nUse pnpm for every install.\r\nAlways run the tests before committing.\r\n\r\n";

export function githubServer(spec: string, permissions: string[], extraEnv: Record<string, string> = {}) {
  return {
    command: "npx",
    args: ["-y", spec],
    env: { GITHUB_TOKEN: FAKE_TOKEN, ...extraEnv },
    permissions,
  };
}

/** A repository configured for Claude Code, Codex and Cursor, all pinned to github MCP 1.4.7. */
export async function createMultiAgentWorkspace(sandbox: Sandbox): Promise<void> {
  const pinned = `${GITHUB_PKG}@1.4.7`;
  const perms = ["pull_request:read", "repo:read"];
  await writeFiles(sandbox.root, {
    "CLAUDE.md": CLAUDE_MD,
    "AGENTS.md": AGENTS_MD,
    ".mcp.json": `${JSON.stringify({ mcpServers: { github: githubServer(pinned, perms) } }, null, 2)}\n`,
    ".claude/settings.json": `${JSON.stringify(
      {
        permissions: { allow: ["Bash(npm test)"], deny: ["Bash(rm -rf *)"] },
        hooks: {
          PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "node .claude/hooks/lint.js" }] }],
        },
      },
      null,
      2,
    )}\n`,
    ".claude/hooks/lint.js": "process.exit(0);\n",
    ".codex/config.toml": [
      "# Codex project configuration",
      'approval_policy = "on-request"',
      "",
      "[mcp_servers.github]",
      'command = "npx"',
      `args = ["-y", "${pinned}"]`,
      "",
      "[mcp_servers.github.env]",
      `GITHUB_TOKEN = "${FAKE_TOKEN}"`,
      "",
    ].join("\n"),
    ".cursor/mcp.json": `${JSON.stringify({ mcpServers: { github: githubServer(pinned, perms) } }, null, 2)}\n`,
    ".cursor/rules/style.mdc": "---\ndescription: Code style\nalwaysApply: true\n---\nPrefer named exports.\n",
    ".agents/skills/frontend-review/SKILL.md": "---\nname: frontend-review\ndescription: Review React components\n---\nCheck accessibility first.\n",
    ".agents/skills/frontend-review/checklist.md": "- [ ] aria labels\n- [ ] keyboard navigation\n",
  });
  await fs.mkdir(path.join(sandbox.home, ".claude"), { recursive: true });
  await writeFiles(sandbox.home, npxCachePackage("1.6.1"));
}

export async function updateJson(base: string, rel: string, mutate: (doc: any) => void): Promise<void> {
  const doc = JSON.parse(await readFile(base, rel));
  mutate(doc);
  await fs.writeFile(path.join(base, rel), `${JSON.stringify(doc, null, 2)}\n`, "utf8");
}
