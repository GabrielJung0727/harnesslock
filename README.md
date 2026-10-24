# 🔒 HarnessLock

**Reproducible configuration for AI coding agents.**
`npm` has `package-lock.json`. Terraform has `.terraform.lock.hcl`. AI coding agents have `harnesslock.lock`.

HarnessLock is a vendor-neutral, git-native lockfile and drift detector for **Claude Code**, **OpenAI Codex**
and **Cursor**. It locks the MCP servers, skills, hooks, rules, permissions and instruction files your
agents load, and tells every developer and CI run — deterministically, in milliseconds — when their
environment no longer matches.

```bash
npx harnesslock init     # derive harnesslock.yaml from what's already in the repo
npx harnesslock lock     # resolve & write harnesslock.lock
npx harnesslock verify   # 0 = clean, 1 = drift, 2 = invalid config
```

## Principles

1. **100% static.** MCP servers and hooks found in config files are never executed. Versions are resolved
   from argv parsing, `node_modules`, `package-lock.json` / `pnpm-lock.yaml`, the npx cache
   (`~/.npm/_npx`, `npm_config_cache`, `%LOCALAPPDATA%\npm-cache`), uv tool installs / uv cache and pipx
   venvs. The only process HarnessLock can ever start is `<agent> --version` for `claude` / `codex` /
   `cursor`, and only with `--check-binaries`.
2. **Deterministic.** No LLM calls. Configs are parsed, secrets redacted, keys sorted recursively and
   serialized as RFC 8785 canonical JSON before SHA-256 fingerprinting. CRLF vs LF, key order and JSON
   formatting never cause drift. Re-locking an unchanged workspace is byte-for-byte idempotent.
3. **Zero secret persistence.** Environment variables are recorded as `{ required: true, value: excluded }`.
   Secret values (by name: `*TOKEN*`, `*KEY*`, `*SECRET*`, `*PASSWORD*`, `*CREDENTIAL*`, `*AUTH*`; or by
   shape: `ghp_`, `github_pat_`, `sk-`, `xoxb-`, `eyJ…`, `AKIA…`, high-entropy blobs) never reach the
   lockfile, reports or fingerprints — rotating a token does not cause drift.
4. **Multi-agent asymmetric tolerance.** A Cursor-only developer is not failed for missing Claude Code
   (`presence: if_installed`), while committed config files are always verified for everyone.

## What is checked

| Area | Sources | Drift codes |
| --- | --- | --- |
| MCP servers | `.mcp.json`, `.claude/settings.json`, `.codex/config.toml`, `.cursor/mcp.json` | `MCP_UNPINNED`, `MCP_VERSION_DRIFT`, `MCP_CONFIG_DRIFT`, `MCP_UNKNOWN`, `MCP_REMOVED`, `MCP_SOURCE_CHANGED`, `MCP_VERSION_OUT_OF_RANGE`, `MCP_NOT_LOCKED`, `MCP_ENV_MISSING` |
| Instructions | `CLAUDE.md`, `AGENTS.md`, any sync group | `CROSS_AGENT_INSTRUCTION_DESYNC`, `INSTRUCTION_HASH_MISMATCH`, `INSTRUCTION_DIRTY`, `INSTRUCTION_UNTRACKED` |
| Skills | `.claude/skills/*`, `.agents/skills/*`, `.codex/skills/*` | `SKILL_DRIFT`, `SKILL_ADDED`, `SKILL_REMOVED`, `SKILL_MISSING` |
| Hooks | `.claude/settings.json` hooks (+ referenced scripts), `.cursor/hooks.json`, Codex `notify` | `HOOK_DRIFT`, `HOOK_ADDED`, `HOOK_REMOVED`, `HOOK_MISSING` |
| Rules | `.cursor/rules/**/*.mdc|md`, `.cursorrules` | `RULE_DRIFT`, `RULE_ADDED`, `RULE_REMOVED` |
| Permissions | MCP `permissions`, Claude `permissions.allow/deny/ask/defaultMode`, Codex `sandbox_mode`/`approval_policy`, `.cursor/cli.json` | `UNEXPECTED_PERMISSION`, `PERMISSION_GUARD_REMOVED` |
| Shadowing | `~/.claude/settings.json`, `~/.claude.json`, `~/.codex/config.toml`, `~/.cursor/mcp.json`, `~/.cursor/hooks.json`, `.claude/settings.local.json` | `USER_SCOPE_SHADOWING`, `LOCAL_SCOPE_SHADOWING` |
| Agents | static install evidence & package metadata | `AGENT_NOT_INSTALLED`, `AGENT_VERSION_MISMATCH`, `NO_ACTIVE_AGENT` |
| Lockfile | `harnesslock.yaml` ↔ `harnesslock.lock` | `LOCK_MISSING`, `SPEC_HASH_MISMATCH`, `CONFIG_PARSE_ERROR` |

User-scope shadowing is **privacy preserving**: by default only the number of unapproved servers/hooks
and the source path (`~/.cursor/mcp.json`) are reported — never names, paths, arguments or env. Pass
`--include-user` to list names.

## Commands

| Command | Purpose |
| --- | --- |
| `harnesslock init [--force] [--dry-run]` | Create `harnesslock.yaml` from the current repository |
| `harnesslock scan [--json] [--include-user]` | Show everything discovered statically |
| `harnesslock lock [--dry-run]` | Write `harnesslock.lock` |
| `harnesslock verify [--ci] [--format text\|json\|sarif\|markdown] [-o file] [--quiet]` | Verify and report |
| `harnesslock diff [--json]` | Expected vs actual for every finding + unified diffs of desynced instruction files |
| `harnesslock sync [--pin] [--sync-instructions] [--dry-run]` | Rewrite configs to match the lock |
| `harnesslock status` | One-screen overview |
| `harnesslock doctor` | Diagnose runtime, config validity, git hooks, agents and caches |
| `harnesslock install-hooks [--uninstall]` | Install `post-checkout`, `post-merge`, `pre-commit` hooks |

Global options: `-C, --cwd <dir>`, `--no-color`. Set `HARNESSLOCK_HOME` to inspect a different home directory.

### `sync`

- Always: re-pins MCP servers whose pinned version differs from the lock and removes permissions the
  policy denies or does not allow.
- `--pin`: additionally pins unpinned servers (`npx -y pkg` → `npx -y pkg@1.4.7`, `uvx pkg` → `uvx pkg==0.6.2`,
  `image:latest` → `image:<tag>`) and copies the canonical instruction file (first existing file of each
  sync group) over desynced members.
- JSON configs keep their indentation and line endings; Codex TOML is edited in place, preserving comments.

### `verify --ci`

Repository mode: checks `harnesslock.yaml` ↔ lock freshness, all committed configs, pins, permissions and
instruction sync, and skips machine-specific checks (installed agents, user scope).

## Configuration (`harnesslock.yaml`)

```yaml
version: 1
agent_strategy:
  require_at_least_one: true
  default_presence: if_installed   # required | if_installed | optional
agents:
  claude-code: { version: ">=2.8.0 <3.0.0", presence: if_installed }
  codex: { version: "^0.150.0" }
  cursor: { version: ">=1.0.0" }
instructions:
  strategy: cross-sync             # cross-sync | git-clean | strict-hash
  sync_groups:
    - name: core-agent-instructions
      files: [CLAUDE.md, AGENTS.md]
      enforce_identical: true
mcp:
  github:
    source: { type: npm, package: "@modelcontextprotocol/server-github" }
    version: "^1.4.0"
    require_pinned: true
    required_env: [GITHUB_TOKEN]
    permissions:
      allow: [repo:read, pull_request:read, pull_request:write]
      deny: [repository:delete, "admin:*"]
skills:
  frontend-review: { path: .agents/skills/frontend-review, required: true }
hooks:
  pre-tool-lint: { event: PreToolUse, agent: claude-code, match: lint, required: true }
policy:                            # error | warn | off
  unknown_project_mcp: error
  unpinned_mcp_version: error
  mcp_drift: error
  user_scope_shadowing: warn
  skill_drift: error
  hook_drift: error
  rule_drift: warn
  unexpected_permissions: error
  instruction_drift: error
user_scope:
  allow_mcp: []                    # user-scope server ids approved for this project
  allow_hooks: false
```

JSON Schemas: [`schemas/harnesslock.schema.json`](schemas/harnesslock.schema.json),
[`schemas/lock.schema.json`](schemas/lock.schema.json).

### Instruction strategies

- **cross-sync** (default): editing `CLAUDE.md` never requires re-locking, but `CLAUDE.md` and `AGENTS.md`
  must stay identical after canonicalization (HTML comments removed, whitespace normalized). A `CLAUDE.md`
  that only imports `@AGENTS.md` counts as synced.
- **git-clean**: instruction files must match the git index (read directly from `.git/index`, no `git` process).
- **strict-hash**: exact SHA-256 of every instruction file is locked.

## Integrations

- **GitHub Action** — [`integrations/github-action/action.yml`](integrations/github-action/action.yml):
  ```yaml
  permissions: { contents: read, security-events: write }
  steps:
    - uses: actions/checkout@v4
    - uses: harnesslock/harnesslock/integrations/github-action@v0.1.0
  ```
  Runs `verify --ci`, uploads SARIF to Code Scanning and writes a markdown job summary.
- **Claude Code skill** — [`integrations/claude-skill/SKILL.md`](integrations/claude-skill/SKILL.md) (read-only verify/diff).
- **OpenAI Codex plugin** — [`integrations/openai-plugin`](integrations/openai-plugin).
- **Git hooks** — `npx harnesslock install-hooks`.

## Programmatic API

```ts
import { createContext, verifyWorkspace, parseMcpCommand, resolveInstalledNpmVersion } from "harnesslock";

const { report } = await verifyWorkspace(createContext({ root: process.cwd() }), { ci: true });
console.log(report.summary, report.events);
```

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Clean (or warnings only) |
| `1` | Drift or policy violation |
| `2` | Invalid `harnesslock.yaml` / `harnesslock.lock`, or internal error |

## Development

```bash
npm install
npm run typecheck
npm test
npm run build && node dist/bin.js --help
```

Requires Node.js >= 20. Licensed under [Apache-2.0](LICENSE).
