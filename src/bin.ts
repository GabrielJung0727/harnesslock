#!/usr/bin/env node
import { Command, InvalidArgumentError, Option } from "commander";
import { runDiff } from "./commands/diff.js";
import { runDoctor } from "./commands/doctor.js";
import { createContext, HarnessLockError, type CommandContext } from "./commands/context.js";
import { runInstallHooks } from "./commands/hooks.js";
import { runInit } from "./commands/init.js";
import { runLock } from "./commands/lock.js";
import { runScan } from "./commands/scan.js";
import { runStatus } from "./commands/status.js";
import { runSync } from "./commands/sync.js";
import { runVerify, type OutputFormat } from "./commands/verify.js";
import { VERSION } from "./version.js";

const program = new Command();

interface GlobalOptions {
  cwd?: string;
  color?: boolean;
}

function context(): CommandContext {
  const globals = program.opts<GlobalOptions>();
  return createContext({ root: globals.cwd, color: globals.color === false ? false : undefined });
}

function parseFormat(value: string): OutputFormat {
  if (value === "text" || value === "json" || value === "sarif" || value === "markdown") return value;
  throw new InvalidArgumentError("expected one of: text, json, sarif, markdown");
}

async function execute(task: (ctx: CommandContext) => Promise<number>): Promise<void> {
  const ctx = context();
  try {
    process.exitCode = await task(ctx);
  } catch (error) {
    if (error instanceof HarnessLockError) {
      ctx.stderr(`harnesslock: ${error.message}\n`);
      process.exitCode = error.exitCode;
      return;
    }
    ctx.stderr(`harnesslock: internal error: ${(error as Error).stack ?? String(error)}\n`);
    process.exitCode = 2;
  }
}

program
  .name("harnesslock")
  .description("Reproducible configuration for AI coding agents — lockfile & drift detection for Claude Code, Codex and Cursor.")
  .version(VERSION, "-v, --version")
  .option("-C, --cwd <dir>", "run as if started in <dir>")
  .option("--no-color", "disable ANSI colors")
  .showHelpAfterError();

program
  .command("init")
  .description("create harnesslock.yaml from the agent configuration already in the repository")
  .option("-f, --force", "overwrite an existing harnesslock.yaml")
  .option("--dry-run", "print the generated configuration instead of writing it")
  .action((opts: { force?: boolean; dryRun?: boolean }) => execute((ctx) => runInit(ctx, opts)));

program
  .command("scan")
  .description("statically discover agent configs, MCP servers, skills, hooks and rules (nothing is executed)")
  .option("--json", "machine-readable output")
  .option("--include-user", "show names of unapproved user-scope MCP servers / hooks")
  .option("--check-binaries", "allow `<agent> --version` on known agent binaries to detect versions")
  .action((opts: { json?: boolean; includeUser?: boolean; checkBinaries?: boolean }) => execute((ctx) => runScan(ctx, opts)));

program
  .command("lock")
  .description("resolve the current state and write harnesslock.lock")
  .option("--dry-run", "compute the lockfile without writing it")
  .action((opts: { dryRun?: boolean }) => execute((ctx) => runLock(ctx, opts)));

program
  .command("verify")
  .description("verify the workspace against harnesslock.yaml and harnesslock.lock")
  .option("--ci", "repository mode: skip machine-specific checks (installed agents, user scope)")
  .addOption(new Option("--format <format>", "output format: text | json | sarif | markdown").argParser(parseFormat).default("text"))
  .option("-o, --output <file>", "write the formatted report to a file")
  .option("-q, --quiet", "print only a one-line banner when drift is detected (for git hooks)")
  .option("--include-user", "show names of unapproved user-scope MCP servers / hooks")
  .option("--check-binaries", "allow `<agent> --version` on known agent binaries to detect versions")
  .action((opts: { ci?: boolean; format: OutputFormat; output?: string; quiet?: boolean; includeUser?: boolean; checkBinaries?: boolean }) =>
    execute((ctx) => runVerify(ctx, opts)),
  );

program
  .command("diff")
  .description("show expected vs actual for every drift, with line diffs for instruction files")
  .option("--ci", "repository mode: skip machine-specific checks")
  .option("--json", "machine-readable output")
  .option("--include-user", "show names of unapproved user-scope MCP servers / hooks")
  .action((opts: { ci?: boolean; json?: boolean; includeUser?: boolean }) => execute((ctx) => runDiff(ctx, opts)));

program
  .command("sync")
  .description("rewrite agent configs to match harnesslock.lock (re-pin versions, drop unauthorized permissions)")
  .option("--pin", "also pin unpinned MCP servers and sync instruction files")
  .option("--sync-instructions", "copy the canonical instruction file across each sync group")
  .option("--dry-run", "show what would change without writing")
  .action((opts: { pin?: boolean; syncInstructions?: boolean; dryRun?: boolean }) => execute((ctx) => runSync(ctx, opts)));

program
  .command("status")
  .description("one-screen overview of lock freshness, agents and drift")
  .action(() => execute((ctx) => runStatus(ctx)));

program
  .command("doctor")
  .description("diagnose the local environment (runtime, config validity, git hooks, agents, caches)")
  .action(() => execute((ctx) => runDoctor(ctx)));

program
  .command("install-hooks")
  .description("install git post-checkout / post-merge / pre-commit hooks running `harnesslock verify --quiet`")
  .option("--uninstall", "remove the harnesslock hook blocks")
  .action((opts: { uninstall?: boolean }) => execute((ctx) => runInstallHooks(ctx, opts)));

program.parseAsync(process.argv).catch((error: unknown) => {
  process.stderr.write(`harnesslock: ${(error as Error).message}\n`);
  process.exitCode = 2;
});
