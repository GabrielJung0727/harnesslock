import { promises as fs } from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { detectAgents, scanWorkspace } from "../adapters/index.js";
import { computeDrift } from "../core/diff-engine.js";
import { readTextIfExists } from "../core/fs-utils.js";
import { evaluateInstructions } from "../core/instruction-sync.js";
import { applyPolicy, exitCodeFor, summarize } from "../core/policy-engine.js";
import { detectShadowing } from "../core/shadowing.js";
import { renderMarkdown } from "../reporter/markdown.js";
import { renderSarif } from "../reporter/sarif.js";
import { renderQuietBanner, renderVerifyReport } from "../reporter/tui.js";
import type { AgentDetection, DriftEvent, ShadowingReport, VerificationReport, WorkspaceScan } from "../types/model.js";
import { VERSION } from "../version.js";
import { loadProject, type CommandContext, type Project } from "./context.js";

export type OutputFormat = "text" | "json" | "sarif" | "markdown";

export interface VerifyOptions {
  /** Repository mode: skip machine-specific checks (installed agents, user scope). */
  ci?: boolean;
  /** Include unapproved user-scope server names in the report. */
  includeUser?: boolean;
  /** Allow `<agent> --version` for well-known agent binaries. */
  checkBinaries?: boolean;
}

export interface VerifyRun {
  report: VerificationReport;
  project: Project;
  scan: WorkspaceScan;
  /** Local mode only. */
  agents?: AgentDetection[];
  /** Local mode only. */
  shadowing?: ShadowingReport;
}

function lineOf(text: string, needles: string[]): number | undefined {
  const lines = text.split(/\r?\n/);
  for (const needle of needles) {
    const index = lines.findIndex((line) => line.includes(needle));
    if (index >= 0) return index + 1;
  }
  return undefined;
}

/** Adds 1-based line numbers for findings located in repository files (used by SARIF / markdown). */
async function attachLines(root: string, events: DriftEvent[]): Promise<void> {
  const cache = new Map<string, string | undefined>();
  for (const event of events) {
    if (!event.file || event.file.startsWith("~")) continue;
    if (!cache.has(event.file)) cache.set(event.file, await readTextIfExists(path.join(root, event.file)));
    const text = cache.get(event.file);
    if (!text) continue;
    const needles: string[] = [];
    const permission = /permission: (.+)$/.exec(event.message)?.[1];
    if (permission) needles.push(`"${permission}"`, permission);
    needles.push(`"${event.componentId}"`, `.${event.componentId}]`, event.componentId);
    event.line = lineOf(text, needles);
  }
}

export async function verifyWorkspace(ctx: CommandContext, options: VerifyOptions = {}): Promise<VerifyRun> {
  const started = performance.now();
  const project = await loadProject(ctx);
  const mode = options.ci ? "ci" : "local";
  const scan = await scanWorkspace(ctx, { resolveCache: mode === "local" });
  const instructions = await evaluateInstructions(ctx.root, project.config);
  const agents = mode === "local" ? await detectAgents(ctx, { checkBinaries: options.checkBinaries }) : undefined;
  const shadowing = mode === "local" ? await detectShadowing(ctx, project.config, { includeUser: options.includeUser }) : undefined;

  const drift = computeDrift({
    mode,
    config: project.config,
    specHash: project.specHash,
    lock: project.lock,
    scan,
    instructions,
    agents,
    shadowing,
  });
  const events = applyPolicy(drift.events, project.config.policy);
  await attachLines(ctx.root, events);

  const report: VerificationReport = {
    tool: "harnesslock",
    version: VERSION,
    mode,
    root: ".",
    presenceStrategy: project.config.agentStrategy.defaultPresence,
    instructionStrategy: project.config.instructions.strategy,
    components: drift.components,
    events,
    summary: summarize(events),
    durationMs: Math.max(1, Math.round(performance.now() - started)),
    exitCode: exitCodeFor(events),
  };
  return { report, project, scan, agents, shadowing };
}

export function formatReport(report: VerificationReport, format: OutputFormat, color: boolean): string {
  switch (format) {
    case "json":
      return `${JSON.stringify(report, null, 2)}\n`;
    case "sarif":
      return renderSarif(report);
    case "markdown":
      return renderMarkdown(report);
    default:
      return renderVerifyReport(report, { color });
  }
}

export interface RunVerifyOptions extends VerifyOptions {
  format?: OutputFormat;
  output?: string;
  quiet?: boolean;
}

export async function runVerify(ctx: CommandContext, options: RunVerifyOptions = {}): Promise<number> {
  const { report } = await verifyWorkspace(ctx, options);
  const format = options.format ?? "text";
  if (options.output) {
    const target = path.resolve(ctx.root, options.output);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, formatReport(report, format, false), "utf8");
    if (!options.quiet) ctx.stdout(renderVerifyReport(report, { color: ctx.color }));
  } else if (options.quiet) {
    const banner = format === "text" ? renderQuietBanner(report, { color: ctx.color }) : "";
    if (banner) ctx.stderr(banner);
  } else {
    ctx.stdout(formatReport(report, format, ctx.color));
  }
  return report.exitCode;
}
