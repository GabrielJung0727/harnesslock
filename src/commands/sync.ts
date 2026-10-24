import { getAdapter, scanWorkspace, type McpEdit } from "../adapters/index.js";
import { evaluatePermission } from "../core/components.js";
import { syncInstructionGroup } from "../core/instruction-sync.js";
import { formatPinnedSpec } from "../core/static-resolver.js";
import { createPalette } from "../reporter/tui.js";
import { VERSIONED_SOURCE_TYPES, type AgentId, type VerificationReport } from "../types/model.js";
import { HarnessLockError, loadProject, type CommandContext } from "./context.js";
import { verifyWorkspace } from "./verify.js";

export interface SyncOptions {
  /** Also pin unpinned MCP servers and sync instruction files. */
  pin?: boolean;
  /** Copy the canonical instruction file over desynced members of each sync group. */
  syncInstructions?: boolean;
  dryRun?: boolean;
}

export interface SyncAction {
  kind: "pin" | "permission" | "instructions";
  file: string;
  message: string;
}

export interface SyncResult {
  actions: SyncAction[];
  report?: VerificationReport;
}

/**
 * Aligns committed agent configs with harnesslock.lock:
 * - re-pins MCP versions that differ from the lock (always) and pins unpinned ones (`--pin`);
 * - removes permissions that the policy denies or does not allow;
 * - copies the canonical instruction file across sync groups (`--sync-instructions` / `--pin`).
 */
export async function syncWorkspace(ctx: CommandContext, options: SyncOptions = {}): Promise<SyncResult> {
  const project = await loadProject(ctx);
  if (!project.lock) throw new HarnessLockError("harnesslock.lock not found. Run `npx harnesslock lock` first.", 1);
  if (project.lock.specHash !== project.specHash) {
    throw new HarnessLockError("harnesslock.lock is stale (harnesslock.yaml changed). Run `npx harnesslock lock` first.", 1);
  }
  const lock = project.lock;
  const scan = await scanWorkspace(ctx, { resolveCache: false });
  const actions: SyncAction[] = [];

  const editsByFile = new Map<string, { agent: AgentId; edits: McpEdit[]; actions: SyncAction[] }>();
  for (const component of scan.mcps) {
    const locked = lock.mcp[component.id];
    if (!locked) continue;
    const declared = project.config.mcp[component.id];
    for (const def of component.definitions) {
      const edit: McpEdit = { id: def.id };
      const pending: SyncAction[] = [];
      const target = locked.resolvedVersion;
      if (VERSIONED_SOURCE_TYPES.includes(def.sourceType) && target && def.packageName && def.specLocation) {
        const needsPin = def.isPinned ? def.declaredVersion !== target : options.pin === true;
        if (needsPin) {
          edit.pinSpec = {
            index: def.specLocation.index,
            value: def.specLocation.prefix + formatPinnedSpec(def.sourceType, def.packageName, target, def.specExtras),
          };
          pending.push({ kind: "pin", file: def.file, message: `pinned ${def.packageName} to ${target}` });
        }
      }
      const rejected = def.permissions.filter((perm) => evaluatePermission(perm, declared?.permissions, locked.permissions.allowed) !== "ok");
      if (rejected.length) {
        edit.removePermissions = rejected;
        for (const perm of rejected) pending.push({ kind: "permission", file: def.file, message: `removed unauthorized permission '${perm}'` });
      }
      if (!edit.pinSpec && !edit.removePermissions) continue;
      const bucket = editsByFile.get(def.file) ?? { agent: def.agent, edits: [], actions: [] };
      bucket.edits.push(edit);
      bucket.actions.push(...pending);
      editsByFile.set(def.file, bucket);
    }
  }

  for (const [file, bucket] of editsByFile) {
    const changed = options.dryRun ? true : await getAdapter(bucket.agent).applyMcpEdits(ctx, file, bucket.edits);
    if (changed) actions.push(...bucket.actions);
  }

  if (options.pin || options.syncInstructions) {
    for (const group of project.config.instructions.syncGroups) {
      for (const action of await syncInstructionGroup(ctx.root, group, options.dryRun)) {
        actions.push({ kind: "instructions", file: action.target, message: `Synced ${action.target} <- ${action.source} (${action.group})` });
      }
    }
  }

  const report = options.dryRun ? undefined : (await verifyWorkspace(ctx)).report;
  return { actions, report };
}

export async function runSync(ctx: CommandContext, options: SyncOptions = {}): Promise<number> {
  const p = createPalette(ctx.color);
  const { actions, report } = await syncWorkspace(ctx, options);
  const out = [`${p.brand("🔧 HarnessLock Sync")} ${p.dim("—")} Aligning local configs to harnesslock.lock${options.dryRun ? p.dim(" (dry run)") : ""}`, ""];
  if (actions.length === 0) out.push(`  ${p.dim("○")} Nothing to change.`);
  for (const action of actions) {
    const text = action.kind === "instructions" ? action.message : `${options.dryRun ? "Would update" : "Updated"} ${action.file}: ${action.message}`;
    out.push(`  ${p.ok("✓")} ${text}`);
  }
  out.push("");
  if (!report) {
    ctx.stdout(`${out.join("\n")}\n`);
    return 0;
  }
  const { errors, warnings } = report.summary;
  if (errors === 0) {
    out.push(`✨ Local agent configuration is now 100% synced with harnesslock.lock!${warnings ? p.dim(` (${warnings} warning${warnings === 1 ? " remains" : "s remain"} — see \`harnesslock verify\`)`) : ""}`);
  } else {
    out.push(`${p.error(`${errors} issue${errors === 1 ? "" : "s"} cannot be fixed automatically.`)} Run ${p.c.cyan("npx harnesslock verify")} for details.`);
    if (!options.pin && report.events.some((e) => e.code === "MCP_UNPINNED" || e.code === "CROSS_AGENT_INSTRUCTION_DESYNC")) {
      out.push(`  ${p.dim("Hint: unpinned servers and instruction drift are fixed with")} ${p.c.cyan("npx harnesslock sync --pin")}`);
    }
  }
  ctx.stdout(`${out.join("\n")}\n`);
  return report.exitCode;
}
