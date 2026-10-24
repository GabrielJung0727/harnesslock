import path from "node:path";
import { ADAPTERS, detectAgents, scanScopes, scanWorkspace } from "../adapters/index.js";
import { homeDisplay, readTextIfExists } from "../core/fs-utils.js";
import { findGitRepo, resolveHooksDir } from "../core/git-index.js";
import { existingNpxCacheRoots } from "../core/static-resolver.js";
import { createPalette, divider, header, SYMBOLS } from "../reporter/tui.js";
import { AGENT_LABELS } from "../types/model.js";
import { HarnessLockError, loadProject, type CommandContext } from "./context.js";
import { GIT_HOOKS, HOOK_MARKER_START } from "./hooks.js";

type CheckState = "ok" | "warn" | "error" | "info";

interface Check {
  state: CheckState;
  label: string;
  detail: string;
}

/** Environment diagnostics: runtime, configuration validity, git integration, agents, caches. */
export async function runDoctor(ctx: CommandContext): Promise<number> {
  const p = createPalette(ctx.color);
  const checks: Check[] = [];

  const major = Number(process.versions.node.split(".")[0]);
  checks.push({ state: major >= 20 ? "ok" : "error", label: "Node.js", detail: `${process.versions.node}${major >= 20 ? "" : " (requires >= 20)"}` });

  try {
    const project = await loadProject(ctx);
    checks.push({ state: "ok", label: "harnesslock.yaml", detail: "valid" });
    if (!project.lock) checks.push({ state: "error", label: "harnesslock.lock", detail: "missing — run `npx harnesslock lock`" });
    else if (project.lock.specHash !== project.specHash) checks.push({ state: "error", label: "harnesslock.lock", detail: "stale — run `npx harnesslock lock`" });
    else checks.push({ state: "ok", label: "harnesslock.lock", detail: `valid, spec in sync (${project.lock.generatedAt})` });
  } catch (error) {
    if (!(error instanceof HarnessLockError)) throw error;
    checks.push({ state: "error", label: "harnesslock.yaml", detail: error.message.split("\n").join(" ") });
  }

  const repo = await findGitRepo(ctx.root);
  if (!repo) {
    checks.push({ state: "warn", label: "git", detail: "not a git repository (git-clean strategy and hooks unavailable)" });
  } else {
    checks.push({ state: "ok", label: "git", detail: "repository detected" });
    const hooksDir = await resolveHooksDir(repo);
    const installed: string[] = [];
    for (const hook of GIT_HOOKS) {
      const text = await readTextIfExists(path.join(hooksDir, hook));
      if (text?.includes(HOOK_MARKER_START)) installed.push(hook);
    }
    checks.push({
      state: installed.length === GIT_HOOKS.length ? "ok" : "info",
      label: "git hooks",
      detail: installed.length ? `installed: ${installed.join(", ")}` : "not installed — run `npx harnesslock install-hooks`",
    });
  }

  const scan = await scanWorkspace(ctx, { resolveCache: false });
  for (const adapter of ADAPTERS) {
    const result = scan.agents.find((a) => a.agent === adapter.id);
    const files = result ? [...result.instructionFiles, ...result.configFilesFound] : [];
    checks.push({
      state: result?.parseErrors.length ? "error" : files.length ? "ok" : "info",
      label: `${adapter.label} config`,
      detail: result?.parseErrors.length
        ? result.parseErrors.map((e) => `${e.file}: ${e.message}`).join("; ")
        : files.length
          ? files.join(", ")
          : "no project files",
    });
  }

  for (const detection of await detectAgents(ctx)) {
    checks.push({
      state: detection.installed ? "ok" : "info",
      label: AGENT_LABELS[detection.agent],
      detail: detection.installed
        ? `installed${detection.version ? ` ${detection.version} (${detection.versionSource})` : " (version unknown statically)"} — ${detection.evidence.join(", ")}`
        : "not installed",
    });
  }

  const caches = await existingNpxCacheRoots(ctx.homeDir, { env: ctx.env, platform: ctx.platform });
  checks.push({
    state: caches.length ? "ok" : "info",
    label: "npx cache",
    detail: caches.length ? caches.map((c) => homeDisplay(c, ctx.homeDir)).join(", ") : "not found (unpinned versions cannot be resolved statically)",
  });

  const scopes = await scanScopes(ctx);
  checks.push({
    state: "info",
    label: "user scope",
    detail: scopes.length ? `${scopes.length} config file${scopes.length === 1 ? "" : "s"} inspected (${scopes.map((s) => s.source).join(", ")})` : "no user-scope agent configs found",
  });

  const out = [header(p, "Doctor"), ""];
  for (const check of checks) {
    const symbol =
      check.state === "ok" ? p.ok(SYMBOLS.ok) : check.state === "warn" ? p.warn(SYMBOLS.warning) : check.state === "error" ? p.error(SYMBOLS.error) : p.dim(SYMBOLS.skipped);
    out.push(`  ${symbol} ${check.label.padEnd(20)} ${check.state === "info" ? p.dim(check.detail) : check.detail}`);
  }
  const errors = checks.filter((c) => c.state === "error").length;
  out.push("", divider(p), errors ? `${p.error(`${errors} problem${errors === 1 ? "" : "s"} found`)}` : p.ok("No problems found"));
  ctx.stdout(`${out.join("\n")}\n`);
  return errors ? 1 : 0;
}
