import { formatUnifiedDiff } from "../core/diff-engine.js";
import { readInstruction } from "../core/instruction-sync.js";
import { createPalette, header, SYMBOLS } from "../reporter/tui.js";
import type { DriftEvent } from "../types/model.js";
import type { CommandContext } from "./context.js";
import { verifyWorkspace, type VerifyOptions } from "./verify.js";

export interface DiffOptions extends VerifyOptions {
  json?: boolean;
}

function colorizeDiff(diff: string, p: ReturnType<typeof createPalette>): string {
  return diff
    .split("\n")
    .map((line) => {
      if (line.startsWith("+++") || line.startsWith("---")) return p.bold(line);
      if (line.startsWith("@@")) return p.c.cyan(line);
      if (line.startsWith("+")) return p.c.green(line);
      if (line.startsWith("-")) return p.c.red(line);
      return line;
    })
    .join("\n");
}

/** Prints every drift event as expected/actual pairs, plus line diffs for desynced instruction files. */
export async function runDiff(ctx: CommandContext, options: DiffOptions = {}): Promise<number> {
  const { report, project } = await verifyWorkspace(ctx, options);
  const p = createPalette(ctx.color);

  const instructionDiffs: Array<{ group: string; diff: string }> = [];
  for (const group of project.config.instructions.syncGroups) {
    const reads = (await Promise.all(group.files.map((f) => readInstruction(ctx.root, f)))).filter((r) => r.exists);
    const source = reads[0];
    if (!source?.canonical) continue;
    for (const target of reads.slice(1)) {
      if (target.hash === source.hash || target.canonical === undefined) continue;
      instructionDiffs.push({ group: group.name, diff: formatUnifiedDiff(source.path, target.path, source.canonical, target.canonical) });
    }
  }

  if (options.json) {
    ctx.stdout(`${JSON.stringify({ events: report.events, instructionDiffs, exitCode: report.exitCode }, null, 2)}\n`);
    return report.exitCode;
  }

  const out = [header(p, "Drift Diff"), ""];
  if (report.events.length === 0) {
    out.push(`  ${p.ok(SYMBOLS.ok)} No drift: the workspace matches harnesslock.lock.`);
  }
  const byFile = new Map<string, DriftEvent[]>();
  for (const event of report.events) {
    const key = event.file ?? "(workspace)";
    byFile.set(key, [...(byFile.get(key) ?? []), event]);
  }
  for (const [file, events] of byFile) {
    out.push(p.bold(file));
    for (const event of events) {
      const symbol = event.severity === "error" ? p.error(SYMBOLS.error) : event.severity === "warning" ? p.warn(SYMBOLS.warning) : p.dim(SYMBOLS.info);
      out.push(`  ${symbol} ${p.dim(`[${event.code}]`)} ${event.componentId}${event.line ? p.dim(`:${event.line}`) : ""} — ${event.message}`);
      if (event.expected !== undefined) out.push(`      ${p.c.red(`- ${event.expected}`)}`);
      if (event.actual !== undefined) out.push(`      ${p.c.green(`+ ${event.actual}`)}`);
      if (event.remediation) out.push(`      ${p.dim(`fix: ${event.remediation}`)}`);
    }
    out.push("");
  }
  for (const { group, diff } of instructionDiffs) {
    out.push(p.bold(`Instruction group: ${group}`), p.dim("(canonical form: HTML comments removed, whitespace normalized)"), colorizeDiff(diff, p), "");
  }
  ctx.stdout(`${out.join("\n")}\n`);
  return report.exitCode;
}
