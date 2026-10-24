---
name: harnesslock
description: Check whether this repository's AI agent configuration (CLAUDE.md/AGENTS.md, MCP servers, skills, hooks, permissions) has drifted from harnesslock.lock. Use when the user asks whether their agent setup matches the team's, before relying on MCP tools, or after pulling changes to .claude/, .cursor/, .codex/ or .mcp.json.
allowed-tools: Bash(npx --no-install harnesslock verify:*), Bash(npx --no-install harnesslock diff:*), Bash(npx --no-install harnesslock status:*), Bash(npx harnesslock verify:*), Bash(npx harnesslock diff:*), Bash(npx harnesslock status:*)
---

# HarnessLock (read-only)

HarnessLock is a static, deterministic lockfile checker for AI coding agent configuration. It never
executes MCP servers or hooks, and never prints secret values.

## What you may run

Only these **read-only** commands, from the repository root:

| Goal | Command |
| --- | --- |
| Full verification report | `npx harnesslock verify --no-color` |
| Machine-readable report | `npx harnesslock verify --format json` |
| Expected vs actual + instruction line diffs | `npx harnesslock diff --no-color` |
| One-screen overview | `npx harnesslock status --no-color` |

Prefer `npx --no-install harnesslock ...` when `harnesslock` is a dev dependency of the project.

## What you must NOT do

- Do **not** run `harnesslock sync`, `harnesslock lock`, `harnesslock init` or `harnesslock install-hooks`.
  These rewrite configuration or the lockfile; they require the user's explicit decision.
- Do **not** edit `harnesslock.lock` by hand.
- Do **not** pass `--include-user`: it reveals the names of the user's personal MCP servers.
  Mention that the flag exists if the user wants that detail and let them run it.

## Interpreting results

- Exit code `0`: clean (warnings may still be listed). `1`: drift or policy violation. `2`: invalid
  `harnesslock.yaml` / internal error.
- `MCP_UNPINNED` / `MCP_VERSION_DRIFT`: an MCP server runs a different or floating version.
- `CROSS_AGENT_INSTRUCTION_DESYNC`: `CLAUDE.md` and `AGENTS.md` (or another sync group) diverged —
  instructions you follow may differ from what Codex/Cursor users get.
- `UNEXPECTED_PERMISSION` / `PERMISSION_GUARD_REMOVED`: permissions were widened beyond policy.
- `USER_SCOPE_SHADOWING`: personal global MCP servers or hooks are active in this project.
- `SPEC_HASH_MISMATCH`: `harnesslock.yaml` changed and the lockfile must be regenerated.

## Reporting back

Summarize errors first, then warnings, quoting the component and file for each. Then suggest — but do
not run — the fix the report recommends, typically:

- `npx harnesslock sync --pin` to pin versions, drop unauthorized permissions and re-sync instruction files;
- `npx harnesslock lock` after an intentional, reviewed change to `harnesslock.yaml`.
