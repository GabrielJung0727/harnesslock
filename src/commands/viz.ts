import { promises as fs } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { detectAgents, scanWorkspace } from "../adapters/index.js";
import { detectShadowing } from "../core/shadowing.js";
import { buildVizGraph, type VizGraph } from "../core/viz-model.js";
import { createPalette, header } from "../reporter/tui.js";
import { renderVizHtml } from "../reporter/viz-html.js";
import { resolveConfig } from "../schema/config-schema.js";
import { VERSION } from "../version.js";
import { findConfigFile, type CommandContext } from "./context.js";
import { verifyWorkspace, type VerifyOptions } from "./verify.js";

export const DEFAULT_VIZ_FILE = "harnesslock-viz.html";

export interface VizOptions extends VerifyOptions {
  /** HTML output path (default: harnesslock-viz.html in the project root). */
  output?: string;
  /** Print the graph model as JSON instead of writing HTML. */
  json?: boolean;
}

/**
 * Builds the graph from a real `verify` run. Without harnesslock.yaml it falls back to the static
 * scan, so `viz` is useful as the very first command in a repository.
 */
export async function buildWorkspaceViz(ctx: CommandContext, options: VizOptions = {}): Promise<VizGraph> {
  const base = { version: VERSION, project: path.basename(ctx.root), generatedAt: new Date().toISOString() };

  if (await findConfigFile(ctx.root)) {
    const run = await verifyWorkspace(ctx, options);
    return buildVizGraph({
      ...base,
      scan: run.scan,
      config: run.project.config,
      lock: run.project.lock,
      report: run.report,
      agents: run.agents,
      shadowing: run.shadowing,
    });
  }

  const config = resolveConfig({ version: 1 });
  const scan = await scanWorkspace(ctx, { resolveCache: !options.ci });
  const agents = options.ci ? undefined : await detectAgents(ctx, { checkBinaries: options.checkBinaries });
  const shadowing = options.ci ? undefined : await detectShadowing(ctx, config, { includeUser: options.includeUser });
  return buildVizGraph({
    ...base,
    scan,
    config,
    agents,
    shadowing,
    note: "No harnesslock.yaml yet — showing discovered configuration only. Run `npx harnesslock init` and `npx harnesslock lock` to verify drift.",
  });
}

export async function runViz(ctx: CommandContext, options: VizOptions = {}): Promise<number> {
  const graph = await buildWorkspaceViz(ctx, options);
  if (options.json) {
    ctx.stdout(`${JSON.stringify(graph, null, 2)}\n`);
    return 0;
  }

  const target = path.resolve(ctx.root, options.output ?? DEFAULT_VIZ_FILE);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, renderVizHtml(graph), "utf8");

  const p = createPalette(ctx.color);
  const flagged = graph.nodes.filter((n) => n.issues.length > 0).length;
  const { errors, warnings } = graph.meta.summary;
  const status =
    graph.meta.mode === "scan-only"
      ? p.warn("scan only (no harnesslock.yaml)")
      : errors > 0
        ? p.error(`${errors} errors, ${warnings} warnings`)
        : p.ok(`${errors} errors, ${warnings} warnings`);
  const out = [
    header(p, "Visualizer"),
    "",
    `  ${p.ok("✓")} Wrote ${path.relative(ctx.root, target) || target}`,
    `    ${p.dim(`${graph.nodes.length} components · ${graph.links.length} connections · ${flagged} flagged`)} · ${status}`,
    "",
    `  Open in your browser: ${p.c.cyan(pathToFileURL(target).href)}`,
    p.dim("  The file is self-contained and works offline. Secret values and user-scope server names are not included."),
  ];
  ctx.stdout(`${out.join("\n")}\n`);
  return 0;
}
