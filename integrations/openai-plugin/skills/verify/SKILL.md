---
name: harnesslock-verify
description: Verify that this repository's agent configuration (AGENTS.md, .codex/config.toml MCP servers, skills, permissions) matches harnesslock.lock, and explain any drift. Read-only.
---

# HarnessLock verify (read-only)

Use this skill when the user asks whether their Codex setup matches the team's locked configuration,
after pulling changes to `AGENTS.md`, `.codex/`, `.agents/skills/`, `.cursor/` or `.mcp.json`, or
before relying on MCP tools in this repository.

## Allowed commands

Run only these, from the repository root:

```bash
npx harnesslock verify --no-color
```

```bash
npx harnesslock diff --no-color
```

```bash
npx harnesslock verify --format json
```

HarnessLock reads files statically: it never starts MCP servers or hooks and never prints secret values.

## Forbidden

- `harnesslock sync`, `harnesslock lock`, `harnesslock init`, `harnesslock install-hooks` — they modify
  files and need the user's explicit decision.
- `--include-user` — it reveals the names of the user's personal MCP servers.
- Editing `harnesslock.lock` by hand.

## Interpreting the result

- Exit `0` = clean (warnings may remain), `1` = drift / policy violation, `2` = invalid `harnesslock.yaml`.
- `MCP_UNPINNED`, `MCP_VERSION_DRIFT`: an MCP server floats or runs another version than the lock.
- `CROSS_AGENT_INSTRUCTION_DESYNC`: `AGENTS.md` and `CLAUDE.md` diverged.
- `UNEXPECTED_PERMISSION`, `PERMISSION_GUARD_REMOVED`: permissions or sandbox settings were widened.
- `USER_SCOPE_SHADOWING`: unapproved MCP servers from `~/.codex/config.toml` (or other agents' user configs) are active.

Report errors first, then warnings, with the component and file for each, and suggest (do not run)
`npx harnesslock sync --pin` or `npx harnesslock lock` as the report recommends.
