import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runInit } from "../src/commands/init.js";
import { runLock } from "../src/commands/lock.js";
import { buildWorkspaceViz, runViz } from "../src/commands/viz.js";
import { embedJson } from "../src/reporter/viz-html.js";
import {
  createMultiAgentWorkspace,
  FAKE_TOKEN,
  GITHUB_PKG,
  makeSandbox,
  readFile,
  testContext,
  updateJson,
  writeFiles,
  type Sandbox,
} from "./helpers.js";

/** Pulls the embedded graph JSON back out of a generated HTML file. */
function embeddedGraph(html: string) {
  const match = /<script id="hl-data" type="application\/json">([\s\S]*?)<\/script>/.exec(html);
  if (!match?.[1]) throw new Error("graph data not found");
  return JSON.parse(match[1]);
}

describe("harnesslock viz", () => {
  let sandbox: Sandbox;
  beforeEach(async () => {
    sandbox = await makeSandbox();
    await createMultiAgentWorkspace(sandbox);
  });
  afterEach(async () => {
    await sandbox.cleanup();
  });

  it("works before init, showing the discovered configuration", async () => {
    const graph = await buildWorkspaceViz(testContext(sandbox));
    expect(graph.meta.mode).toBe("scan-only");
    expect(graph.meta.note).toContain("harnesslock init");
    const ids = graph.nodes.map((n) => n.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        "lock",
        "agent:claude-code",
        "agent:codex",
        "agent:cursor",
        "instr:CLAUDE.md",
        "instr:AGENTS.md",
        "mcp:github",
        "perm:github:repo:read",
        "agentperm:claude-code",
        "skill:frontend-review",
        "rule:.cursor/rules/style.mdc",
      ]),
    );
    expect(graph.nodes.every((n) => n.issues.length === 0)).toBe(true);
    // One edge per agent that defines the server.
    expect(graph.links.filter((l) => l.target === "mcp:github").map((l) => l.source).sort()).toEqual([
      "agent:claude-code",
      "agent:codex",
      "agent:cursor",
    ]);
  });

  it("is all green on a clean, locked workspace", async () => {
    const ctx = testContext(sandbox);
    await runInit(ctx);
    await runLock(ctx);
    const graph = await buildWorkspaceViz(testContext(sandbox));
    expect(graph.meta).toMatchObject({ mode: "local", summary: { errors: 0, warnings: 0 } });
    expect(graph.nodes.filter((n) => n.status === "error" || n.status === "warning")).toEqual([]);
    expect(graph.links.some((l) => l.kind === "sync" && l.source === "instr:CLAUDE.md" && l.target === "instr:AGENTS.md")).toBe(true);
    expect(graph.nodes.find((n) => n.id === "lock")?.label).toBe("harnesslock.lock");
  });

  it("attaches every verify finding to the node and edge it concerns", async () => {
    const ctx = testContext(sandbox);
    await runInit(ctx);
    await runLock(ctx);
    await updateJson(sandbox.root, ".cursor/mcp.json", (doc) => {
      doc.mcpServers.github.args = ["-y", `${GITHUB_PKG}@latest`];
      doc.mcpServers.github.permissions.push("repository:delete");
    });
    await writeFiles(sandbox.root, { "AGENTS.md": "# Project rules\n\nUse npm instead.\n" });
    await writeFiles(sandbox.home, { ".cursor/mcp.json": JSON.stringify({ mcpServers: { "personal-db": { command: "node" } } }) });

    const graph = await buildWorkspaceViz(testContext(sandbox));
    expect(graph.meta.summary).toEqual({ errors: 3, warnings: 1 });
    const node = (id: string) => graph.nodes.find((n) => n.id === id);

    expect(node("mcp:github")?.status).toBe("error");
    expect(node("mcp:github")?.issues.map((i) => i.code)).toEqual(["MCP_UNPINNED"]);
    expect(node("perm:github:repository:delete")).toMatchObject({ status: "error", issues: [expect.objectContaining({ code: "UNEXPECTED_PERMISSION" })] });
    expect(node("instr:AGENTS.md")?.issues.map((i) => i.code)).toEqual(["CROSS_AGENT_INSTRUCTION_DESYNC"]);
    expect(node("scope:~/.cursor/mcp.json")).toMatchObject({ status: "warning" });
    expect(node("lock")?.issues).toEqual([]);

    const edge = (s: string, t: string) => graph.links.find((l) => l.source === s && l.target === t);
    expect(edge("agent:cursor", "mcp:github")?.status).toBe("error");
    expect(edge("agent:claude-code", "mcp:github")?.status).toBe("ok");
    expect(edge("instr:CLAUDE.md", "instr:AGENTS.md")?.status).toBe("error");
    expect(edge("mcp:github", "perm:github:repository:delete")?.status).toBe("error");

    // Privacy: user-scope names only with --include-user.
    expect(JSON.stringify(graph)).not.toContain("personal-db");
    const detailed = await buildWorkspaceViz(testContext(sandbox), { includeUser: true });
    expect(JSON.stringify(detailed)).toContain("personal-db");
  });

  it("writes a self-contained HTML file without secrets", async () => {
    const ctx = testContext(sandbox);
    await runInit(ctx);
    await runLock(ctx);
    expect(await runViz(ctx, { output: "out/graph.html" })).toBe(0);
    expect(ctx.output()).toContain("Wrote out");
    const html = await readFile(sandbox.root, "out/graph.html");
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).not.toMatch(/<script[^>]+src=|<link[^>]+stylesheet|https?:\/\/(?!json\.schemastore|www\.w3\.org)/);
    expect(html).toContain("Content-Security-Policy");
    expect(html).not.toContain(FAKE_TOKEN);
    expect(embeddedGraph(html).nodes.length).toBeGreaterThan(10);
  });

  it("cannot be broken out of by hostile names in config files", async () => {
    const hostile = '</script><script>alert(1)</script>';
    await updateJson(sandbox.root, ".mcp.json", (doc) => {
      doc.mcpServers[hostile] = { command: "node", args: [`${hostile}.js`] };
    });
    const ctx = testContext(sandbox);
    await runViz(ctx);
    const html = await readFile(sandbox.root, "harnesslock-viz.html");
    expect(html).not.toContain("<script>alert(1)");
    expect(html.match(/<\/script>/g)).toHaveLength(2);
    // The name survives as data and is rendered with textContent by the page.
    expect(embeddedGraph(html).nodes.some((n: { label: string }) => n.label === hostile)).toBe(true);
  });

  it("escapes characters that would terminate or confuse an inline script", () => {
    const encoded = embedJson({ v: `</script><!--&${String.fromCharCode(0x2028)}` });
    for (const ch of ["<", ">", "&", String.fromCharCode(0x2028)]) expect(encoded.includes(ch)).toBe(false);
    expect(JSON.parse(encoded).v).toBe(`</script><!--&${String.fromCharCode(0x2028)}`);
  });

  it("prints the graph model with --json", async () => {
    const ctx = testContext(sandbox);
    await runViz(ctx, { json: true });
    const graph = JSON.parse(ctx.output());
    expect(graph.meta.tool).toBe("harnesslock");
    expect(graph.nodes.length).toBeGreaterThan(5);
  });
});
