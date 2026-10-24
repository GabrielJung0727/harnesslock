import { detectAgents } from "../adapters/index.js";
import { createPalette, header, SYMBOLS } from "../reporter/tui.js";
import { AGENT_LABELS } from "../types/model.js";
import { HarnessLockError, loadProject, type CommandContext } from "./context.js";
import { verifyWorkspace } from "./verify.js";

/** Compact one-screen overview: config, lock freshness, agents, tracked components, drift counts. */
export async function runStatus(ctx: CommandContext): Promise<number> {
  const p = createPalette(ctx.color);
  const out = [header(p, "Status"), ""];
  let project;
  try {
    project = await loadProject(ctx);
  } catch (error) {
    if (error instanceof HarnessLockError) {
      out.push(`  ${p.error(SYMBOLS.error)} ${error.message}`);
      ctx.stdout(`${out.join("\n")}\n`);
      return error.exitCode;
    }
    throw error;
  }
  out.push(`  ${"Config".padEnd(10)}${p.ok(SYMBOLS.ok)} harnesslock.yaml`);
  if (!project.lock) {
    out.push(`  ${"Lock".padEnd(10)}${p.error(SYMBOLS.error)} harnesslock.lock missing — run ${p.c.cyan("npx harnesslock lock")}`);
  } else {
    const fresh = project.lock.specHash === project.specHash;
    out.push(
      `  ${"Lock".padEnd(10)}${fresh ? p.ok(SYMBOLS.ok) : p.error(SYMBOLS.error)} harnesslock.lock ${p.dim(`(generated ${project.lock.generatedAt})`)} ${
        fresh ? p.dim("spec in sync") : p.error("stale: harnesslock.yaml changed")
      }`,
    );
  }

  const detections = await detectAgents(ctx);
  const agentText = detections
    .map((d) => (d.installed ? `${p.ok(SYMBOLS.ok)} ${AGENT_LABELS[d.agent]}${d.version ? ` ${d.version}` : ""}` : `${p.dim(`${SYMBOLS.skipped} ${AGENT_LABELS[d.agent]}`)}`))
    .join(p.dim("  ·  "));
  out.push(`  ${"Agents".padEnd(10)}${agentText}`);

  if (project.lock) {
    const lock = project.lock;
    out.push(
      `  ${"Tracked".padEnd(10)}${Object.keys(lock.mcp).length} MCP · ${Object.keys(lock.skills).length} skills · ${Object.keys(lock.hooks).length} hooks · ${
        Object.keys(lock.rules).length
      } rules · ${Object.keys(lock.instructions.syncGroups).length} instruction groups`,
    );
  }

  const { report } = await verifyWorkspace(ctx);
  const { errors, warnings } = report.summary;
  if (errors === 0 && warnings === 0) out.push(`  ${"Drift".padEnd(10)}${p.ok(`${SYMBOLS.ok} clean`)}`);
  else {
    const symbol = errors > 0 ? p.error(SYMBOLS.error) : p.warn(SYMBOLS.warning);
    out.push(`  ${"Drift".padEnd(10)}${symbol} ${errors} errors, ${warnings} warnings → ${p.c.cyan("npx harnesslock verify")}`);
  }
  ctx.stdout(`${out.join("\n")}\n`);
  return report.exitCode;
}
