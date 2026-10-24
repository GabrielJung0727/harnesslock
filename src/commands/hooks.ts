import { promises as fs } from "node:fs";
import path from "node:path";
import { findGitRepo, resolveHooksDir } from "../core/git-index.js";
import { readTextIfExists, relPosix } from "../core/fs-utils.js";
import { createPalette, header } from "../reporter/tui.js";
import { HarnessLockError, type CommandContext } from "./context.js";

export const HOOK_MARKER_START = "# >>> harnesslock >>>";
export const HOOK_MARKER_END = "# <<< harnesslock <<<";
export const GIT_HOOKS = ["post-checkout", "post-merge", "pre-commit"] as const;
export type GitHookName = (typeof GIT_HOOKS)[number];

export function hookBlock(hook: GitHookName): string {
  const command = "npx --no-install harnesslock verify --quiet";
  const body =
    hook === "pre-commit"
      ? // Block commits that would ship broken agent configuration.
        `${command} || exit 1`
      : // Informational only: never fail a checkout or merge.
        `${command} || true`;
  return `${HOOK_MARKER_START}\n# Installed by \`harnesslock install-hooks\`. Remove with \`harnesslock install-hooks --uninstall\`.\n${body}\n${HOOK_MARKER_END}\n`;
}

const BLOCK_PATTERN = new RegExp(
  `${HOOK_MARKER_START.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\S]*?${HOOK_MARKER_END.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\r?\\n?`,
);

/** Inserts (or refreshes) the harnesslock block, keeping any existing hook content intact. */
export function upsertHookContent(existing: string | undefined, hook: GitHookName): string {
  const block = hookBlock(hook);
  if (existing === undefined || existing.trim() === "") return `#!/bin/sh\n${block}`;
  if (BLOCK_PATTERN.test(existing)) return existing.replace(BLOCK_PATTERN, block);
  const separator = existing.endsWith("\n") ? "\n" : "\n\n";
  return `${existing}${separator}${block}`;
}

/** Removes the block together with the blank separator line `upsertHookContent` added before it. */
export function removeHookContent(existing: string): string {
  return existing.replace(new RegExp(`(\\r?\\n)?${BLOCK_PATTERN.source}`), "");
}

export interface HookInstallResult {
  hooksDir: string;
  installed: Array<{ hook: GitHookName; action: "created" | "updated" | "removed" | "unchanged" }>;
}

export async function installGitHooks(ctx: CommandContext, options: { uninstall?: boolean } = {}): Promise<HookInstallResult> {
  const repo = await findGitRepo(ctx.root);
  if (!repo) throw new HarnessLockError("Not a git repository (no .git directory found).", 1);
  const hooksDir = await resolveHooksDir(repo);
  await fs.mkdir(hooksDir, { recursive: true });
  const installed: HookInstallResult["installed"] = [];

  for (const hook of GIT_HOOKS) {
    const file = path.join(hooksDir, hook);
    const existing = await readTextIfExists(file);
    if (options.uninstall) {
      if (existing === undefined || !BLOCK_PATTERN.test(existing)) {
        installed.push({ hook, action: "unchanged" });
        continue;
      }
      const remaining = removeHookContent(existing);
      if (remaining.replace(/^#!.*$/m, "").trim() === "") await fs.rm(file);
      else await fs.writeFile(file, remaining, "utf8");
      installed.push({ hook, action: "removed" });
      continue;
    }
    const next = upsertHookContent(existing, hook);
    if (next === existing) {
      installed.push({ hook, action: "unchanged" });
    } else {
      await fs.writeFile(file, next, "utf8");
      installed.push({ hook, action: existing === undefined ? "created" : "updated" });
    }
    await fs.chmod(file, 0o755);
  }
  return { hooksDir, installed };
}

export async function runInstallHooks(ctx: CommandContext, options: { uninstall?: boolean } = {}): Promise<number> {
  const p = createPalette(ctx.color);
  const result = await installGitHooks(ctx, options);
  const dir = relPosix(ctx.root, result.hooksDir) || ".";
  const out = [header(p, options.uninstall ? "Uninstall Git Hooks" : "Install Git Hooks"), ""];
  for (const { hook, action } of result.installed) {
    const symbol = action === "unchanged" ? p.dim("○") : p.ok("✓");
    out.push(`  ${symbol} ${`${dir}/${hook}`.padEnd(32)} ${p.dim(action)}`);
  }
  if (!options.uninstall) {
    out.push("", p.dim("  post-checkout/post-merge warn on drift; pre-commit blocks commits with errors (bypass: git commit --no-verify)."));
  }
  ctx.stdout(`${out.join("\n")}\n`);
  return 0;
}
