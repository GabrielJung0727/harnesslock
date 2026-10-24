<h1 align="center">🔒 HarnessLock</h1>

<p align="center">
  <b>Reproducible configuration for AI coding agents.</b><br/>
  <code>npm</code> has <code>package-lock.json</code>. Terraform has <code>.terraform.lock.hcl</code>. AI coding agents have <code>harnesslock.lock</code>.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/harnesslock"><img src="https://img.shields.io/npm/v/harnesslock" alt="npm version"/></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-Apache%202.0-blue" alt="License: Apache-2.0"/></a>
  <img src="https://img.shields.io/badge/node-%3E%3D20-339933?logo=node.js&logoColor=white" alt="Node.js >= 20"/>
  <img src="https://img.shields.io/badge/agents-Claude%20Code%20%C2%B7%20Codex%20%C2%B7%20Cursor-6f42c1" alt="Claude Code, Codex, Cursor"/>
  <img src="https://img.shields.io/badge/execution-100%25%20static-0b7285" alt="100% static"/>
  <img src="https://img.shields.io/badge/LLM%20calls-0-118d4f" alt="0 LLM calls"/>
</p>

<p align="center">
  <a href="#get-started">Get started</a> ·
  <a href="#see-it-in-action">See it in action</a> ·
  <a href="#what-it-checks">What it checks</a> ·
  <a href="#configuration">Configuration</a> ·
  <a href="#ci-and-integrations">CI & integrations</a> ·
  <a href="#privacy-and-security">Privacy</a>
</p>

---

Your team shares the same git commit and the same `package-lock.json`, but every developer's AI agent runs a
**different environment**: one `.cursor/mcp.json` pulls `npx -y @modelcontextprotocol/server-github` at
whatever version is latest today, `CLAUDE.md` was updated but `AGENTS.md` wasn't, someone granted
`repository:delete`, and a personal database MCP in `~/.cursor/mcp.json` quietly joins every session.

**HarnessLock** is a vendor-neutral, git-native lockfile and drift detector for **Claude Code**,
**OpenAI Codex** and **Cursor**. It locks the MCP servers, skills, hooks, rules, permissions and instruction
files your agents load, and tells every developer and every CI run when an environment no longer matches.

- **100% static.** MCP servers and hooks found in config files are **never executed**. Versions come from
  argv parsing, `node_modules`, lockfiles and local package-runner caches.
- **Deterministic.** No LLM calls. Configs are redacted, key-sorted and hashed as RFC 8785 canonical JSON, so
  CRLF vs LF, key order and formatting never cause false drift.
- **Zero secret persistence.** Environment variables are recorded only as `value: excluded`. Rotating a
  token does not change any fingerprint.
- **Multi-agent tolerant.** A Cursor-only developer is not failed for missing Claude Code, while the configs
  committed to the repository are verified for everyone.

---

## Get started

Choose the path that fits your workflow:

| Best for | Install |
| --- | --- |
| **Try it now** (no install) | `npx harnesslock init` |
| **Team repositories** (pinned dev dependency) | `npm i -D harnesslock` |
| **CI / pull requests** | [GitHub Action](#github-action) → SARIF + job summary |
| **Every `git pull` and commit** | `npx harnesslock install-hooks` |
| **Claude Code** (read-only agent skill) | [`integrations/claude-skill`](integrations/claude-skill/SKILL.md) |
| **OpenAI Codex** (read-only plugin) | [`integrations/openai-plugin`](integrations/openai-plugin) |

Three commands take you from zero to a verified environment:

```bash
npx harnesslock init     # derive harnesslock.yaml from what is already in the repo
npx harnesslock lock     # resolve the current state and write harnesslock.lock
npx harnesslock verify   # 0 = clean, 1 = drift, 2 = invalid config
```

Commit both files:

```
repository/
├── harnesslock.yaml   desired state & policy, written by people
└── harnesslock.lock   resolved state & SHA-256 fingerprints, written by `harnesslock lock`
```

---

## See it in action

Clean workspace (actual output):

```text
$ npx harnesslock verify
🔒 HarnessLock v0.1.0 — Environment Verification
────────────────────────────────────────────────────────────

Agents (Strategy: if_installed)
  ✓ Claude Code        installed
  ○ Codex              not installed (skipped by policy)
  ✓ Cursor             3.22.12 (satisfies >=3.22.0)

Instructions (Strategy: cross-sync)
  ✓ core-agent-instructions CLAUDE.md == AGENTS.md (synced)

MCP Servers
  ✓ github             1.4.7 (pinned across 2 configs)

Security & Permissions
  ✓ github             1 permission within policy
  ✓ user-scope         no unapproved global MCPs or hooks

────────────────────────────────────────────────────────────
Status: PASSED (0 errors, 0 warnings) in 215ms
```

After someone unpins the GitHub MCP in `.cursor/mcp.json`, grants `repository:delete`, edits only
`AGENTS.md`, and a personal MCP appears in `~/.cursor/mcp.json`:

```text
$ npx harnesslock verify
Instructions (Strategy: cross-sync)
  ✕ core-agent-instructions cross-agent instruction drift: CLAUDE.md != AGENTS.md (AGENTS.md is newer)
                       expected: CLAUDE.md sha256:2e8a0bb9
                       actual:   AGENTS.md sha256:46e14eee

MCP Servers
  ✕ github             version drift & unpinned config
                       expected: 1.4.7 (pinned)
                       actual:   unversioned in .cursor/mcp.json (cached: 1.6.1)

Security & Permissions
  ✕ github             unexpected permission: repository:delete
                       expected: within allow list [repo:read]
                       actual:   repository:delete in .cursor/mcp.json
  ⚠ user-scope         1 unapproved global MCP detected in ~/.cursor/mcp.json

────────────────────────────────────────────────────────────
Status: FAILED (3 errors, 1 warning) in 225ms

💡 Quick Remediation:
  • View exact line diffs:      npx harnesslock diff
  • Auto-pin & sync configs:    npx harnesslock sync --pin
```

One command fixes everything that belongs to the repository:

```text
$ npx harnesslock sync --pin
🔧 HarnessLock Sync — Aligning local configs to harnesslock.lock

  ✓ Updated .cursor/mcp.json: pinned @modelcontextprotocol/server-github to 1.4.7
  ✓ Updated .cursor/mcp.json: removed unauthorized permission 'repository:delete'
  ✓ Synced AGENTS.md <- CLAUDE.md (core-agent-instructions)

✨ Local agent configuration is now 100% synced with harnesslock.lock! (1 warning remains — see `harnesslock verify`)
```

The personal global MCP is reported, never silently changed: it lives in the developer's home directory,
and only its **count** and **source path** are shown. Its name appears only with `--include-user`.

---

## What it checks

| Capability | What you get |
| --- | --- |
| **MCP version pinning** | Detects floating versions (`npx -y pkg`, `pkg@latest`, `uvx pkg`, `image:latest`) and pins them to the locked version |
| **Static version resolution** | Finds the version that actually runs from `node_modules`, `package-lock.json` / `pnpm-lock.yaml`, the npx cache, uv tools / uv cache and pipx venvs, without executing anything |
| **Cross-agent instruction sync** | Keeps `CLAUDE.md`, `AGENTS.md` and other sync groups identical after canonicalization, with a unified diff when they are not |
| **Config fingerprints** | Command, arguments and environment *keys* of every MCP server, per config file |
| **Skills, hooks & rules** | Content hashes for `.claude/skills`, `.agents/skills`, hook commands **and the scripts they call**, `.cursor/rules` |
| **Permission policy** | Allow/deny globs for MCP permissions, plus Claude `permissions`, Codex sandbox/approval policy and Cursor CLI rules |
| **Shadowing detection** | Unapproved MCP servers and hooks injected from `~/` or gitignored local settings, reported as counts only |
| **Agent presence** | `required` / `if_installed` / `optional` per agent, with semver ranges checked against static package metadata |
| **Remediation** | `sync` rewrites JSON while keeping its indentation and line endings, and edits Codex TOML in place, keeping comments |
| **Reports** | Terminal, JSON, SARIF 2.1.0 (GitHub Code Scanning) and markdown (PR comments / job summaries) |

### Supported agents

| Agent | Project files | User scope (shadowing) |
| --- | --- | --- |
| **Claude Code** | `CLAUDE.md`, `.claude/CLAUDE.md`, `.mcp.json`, `.claude/settings.json`, `.claude/skills/`, `.claude/hooks/` | `~/.claude/settings.json`, `~/.claude.json`, `.claude/settings.local.json` |
| **OpenAI Codex** | `AGENTS.md`, `.codex/config.toml`, `.agents/skills/`, `.codex/skills/` | `~/.codex/config.toml` (`CODEX_HOME`) |
| **Cursor** | `AGENTS.md`, `.cursor/mcp.json`, `.cursor/rules/**/*.mdc\|md`, `.cursorrules`, `.cursor/hooks.json`, `.cursor/cli.json` | `~/.cursor/mcp.json`, `~/.cursor/hooks.json` |

### How it works

```text
Raw config ─► Parse (JSON/JSONC/TOML/YAML) ─► Redact secrets ─► Sort keys recursively
           ─► Canonical JSON (RFC 8785) ─► SHA-256 fingerprint ─► compare with harnesslock.lock
```

Instruction files go through their own canonical form: HTML comments are removed, line endings and trailing
whitespace normalized, blank-line runs collapsed, and Claude-style `@AGENTS.md` import lines expanded.

---

## Prerequisites

| Requirement | Minimum | Check |
| --- | --- | --- |
| Node.js | 20+ | `node --version` |
| git *(optional)* | any | needed only for `install-hooks` and the `git-clean` strategy (the index is read directly; `git` is never executed) |

---

## Common commands

```bash
npx harnesslock init                      # create harnesslock.yaml (--force to overwrite, --dry-run to print)
npx harnesslock scan                      # show everything discovered statically (--json, --include-user)
npx harnesslock lock                      # write harnesslock.lock (idempotent: unchanged state = unchanged file)

npx harnesslock verify                    # full report for this machine
npx harnesslock verify --ci               # repository mode: skip installed agents & user scope
npx harnesslock verify --format sarif -o harnesslock.sarif
npx harnesslock verify --format markdown  # PR comment / job summary
npx harnesslock verify --quiet            # one-line banner on drift (used by git hooks)

npx harnesslock diff                      # expected vs actual + line diffs of desynced instructions
npx harnesslock sync                      # re-pin mismatched versions, drop unauthorized permissions
npx harnesslock sync --pin                # ...and pin unpinned servers + sync instruction files
npx harnesslock sync --pin --dry-run      # preview without writing

npx harnesslock status                    # one-screen overview
npx harnesslock doctor                    # runtime, config validity, git hooks, agents, caches
npx harnesslock install-hooks             # post-checkout, post-merge, pre-commit (--uninstall)
```

Global options: `-C, --cwd <dir>`, `--no-color`. Set `HARNESSLOCK_HOME` to inspect a different home directory.

### Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Clean, or warnings only |
| `1` | Drift or policy violation |
| `2` | Invalid `harnesslock.yaml` / `harnesslock.lock`, or internal error |

---

## Configuration

`harnesslock init` writes a starting point from your repository. A complete `harnesslock.yaml`:

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

Editor autocompletion: [`schemas/harnesslock.schema.json`](schemas/harnesslock.schema.json) and
[`schemas/lock.schema.json`](schemas/lock.schema.json).

<details>
<summary><b>Agent presence policies</b></summary>

| Presence | Agent not installed | Version outside range |
| --- | --- | --- |
| `required` | error | error |
| `if_installed` *(default)* | skipped | error |
| `optional` | skipped | warning |

Committed configuration files (`.cursor/mcp.json`, `.codex/config.toml`, ...) are **always** verified,
whether or not the agent is installed. `require_at_least_one: true` fails when none of the configured agents is
installed and compliant.

</details>

<details>
<summary><b>Instruction strategies</b></summary>

| Strategy | Behaviour | Re-lock after editing `CLAUDE.md`? |
| --- | --- | --- |
| `cross-sync` *(default)* | Sync group members must be identical after canonicalization | No |
| `git-clean` | Instruction files must match the git index (read from `.git/index`) | No |
| `strict-hash` | The exact SHA-256 of every instruction file is locked | Yes |

A `CLAUDE.md` that only contains `@AGENTS.md` counts as synced with `AGENTS.md`.

</details>

<details>
<summary><b>How <code>sync</code> remediates</b></summary>

| Situation | `sync` | `sync --pin` |
| --- | --- | --- |
| Pinned to a different version than the lock | re-pinned | re-pinned |
| Unpinned (`pkg`, `pkg@latest`, `uvx pkg`, `image:latest`) | — | pinned (`pkg@1.4.7`, `pkg==0.6.2`, `image:<tag>`) |
| Permission denied by / outside the policy | removed | removed |
| Desynced instruction files | — | first existing file of the group copied over the others (also `--sync-instructions`) |
| Lockfile stale (`harnesslock.yaml` changed) | refuses, asks for `harnesslock lock` | refuses |
| Unapproved user-scope MCP | reported only | reported only |

</details>

<details>
<summary><b>Drift codes</b></summary>

| Area | Codes |
| --- | --- |
| Lockfile | `LOCK_MISSING`, `SPEC_HASH_MISMATCH`, `CONFIG_PARSE_ERROR` |
| Agents | `AGENT_NOT_INSTALLED`, `AGENT_VERSION_MISMATCH`, `NO_ACTIVE_AGENT` |
| Instructions | `CROSS_AGENT_INSTRUCTION_DESYNC`, `INSTRUCTION_HASH_MISMATCH`, `INSTRUCTION_DIRTY`, `INSTRUCTION_UNTRACKED`, `INSTRUCTION_MISSING` |
| MCP servers | `MCP_UNPINNED`, `MCP_VERSION_DRIFT`, `MCP_VERSION_OUT_OF_RANGE`, `MCP_CONFIG_DRIFT`, `MCP_SOURCE_CHANGED`, `MCP_UNKNOWN`, `MCP_NOT_LOCKED`, `MCP_REMOVED`, `MCP_ENV_MISSING`, `MCP_DECLARED_NOT_CONFIGURED` |
| Skills | `SKILL_DRIFT`, `SKILL_ADDED`, `SKILL_REMOVED`, `SKILL_MISSING` |
| Hooks | `HOOK_DRIFT`, `HOOK_ADDED`, `HOOK_REMOVED`, `HOOK_MISSING` |
| Rules | `RULE_DRIFT`, `RULE_ADDED`, `RULE_REMOVED` |
| Security | `UNEXPECTED_PERMISSION`, `PERMISSION_GUARD_REMOVED`, `USER_SCOPE_SHADOWING`, `LOCAL_SCOPE_SHADOWING` |

</details>

---

## CI and integrations

### GitHub Action

```yaml
# .github/workflows/harnesslock.yml
name: harnesslock
on: [pull_request]
permissions:
  contents: read
  security-events: write
jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: harnesslock/harnesslock/integrations/github-action@v0.1.0
```

The [composite action](integrations/github-action/action.yml) runs `harnesslock verify --ci`, uploads SARIF to
GitHub Code Scanning and writes a markdown report to the job summary. Inputs: `version`, `working-directory`,
`sarif`, `sarif-file`, `job-summary`, `fail-on-drift`.

### Git hooks

```bash
npx harnesslock install-hooks
```

- `post-checkout` and `post-merge` print a warning banner when a `git pull` brings in drift.
- `pre-commit` blocks commits that would ship broken agent configuration (bypass with `git commit --no-verify`).

Existing hook content is kept; the HarnessLock block is added between markers and removed by `--uninstall`.

### Agent skills

- **Claude Code** — [`integrations/claude-skill/SKILL.md`](integrations/claude-skill/SKILL.md)
- **OpenAI Codex** — [`integrations/openai-plugin`](integrations/openai-plugin)

Both are **read-only**: they allow `verify`, `diff` and `status`, and tell the agent never to run `sync`, `lock`,
`init` or `install-hooks`, or to pass `--include-user`.

### Programmatic API

```ts
import { createContext, verifyWorkspace, parseMcpCommand, resolveInstalledNpmVersion } from "harnesslock";

const { report } = await verifyWorkspace(createContext({ root: process.cwd() }), { ci: true });
console.log(report.summary, report.events);

parseMcpCommand("npx", ["-y", "@modelcontextprotocol/server-github"]);
// → { sourceType: "npm", packageName: "@modelcontextprotocol/server-github", isPinned: false, ... }
```

---

## Privacy and security

- **Nothing discovered is executed.** MCP launch commands and hook scripts are parsed, never run, so a malicious
  config (`curl … | sh`) cannot execute during a scan. The only process HarnessLock can start is
  `<agent> --version` for `claude`, `codex` or `cursor`, and only with `--check-binaries`.
- **Secrets never reach the lockfile.** Values whose names match `TOKEN`, `KEY`, `SECRET`, `PASSWORD`,
  `CREDENTIAL` or `AUTH`, or whose shape looks like a credential (`ghp_`, `github_pat_`, `sk-`, `xoxb-`, `eyJ…`,
  `AKIA…`, high-entropy blobs), are excluded from output **and** from fingerprints. Arguments such as
  `--api-key=…`, `Bearer …` and URL credentials are redacted.
- **User scope stays private.** Files in your home directory are read to count unapproved MCP servers and hooks;
  names, paths, arguments and environment are never printed or stored unless you pass `--include-user`.
- **No network, no telemetry, no LLM.** Everything runs locally and deterministically.

---

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| `installed (version not statically resolvable)` | The agent was found but has no readable package metadata (e.g. a native installer). Add `--check-binaries` to allow `<agent> --version`. |
| `MCP_UNPINNED` with no `cached:` version | The package was never installed locally, so there is no cached version to lock. Pin it in the config, or set an exact `version` in `harnesslock.yaml`. |
| `SPEC_HASH_MISMATCH` | `harnesslock.yaml` changed after locking. Review the change and run `npx harnesslock lock`. |
| `pre-commit` blocks every commit | The hook runs `npx --no-install harnesslock`, which fails when harnesslock is not installed in the project. Run `npm i -D harnesslock`, or `npx harnesslock install-hooks --uninstall`. |
| Comments disappeared from `.cursor/mcp.json` after `sync` | JSON files are rewritten with their indentation and line endings kept, but JSONC comments are not. Codex TOML is edited in place and keeps comments (except for inline-table layouts). |
| Exit code `2` | `harnesslock.yaml` or `harnesslock.lock` is invalid; the error lists each problem with its path. |

---

## Development

```bash
npm install
npm run typecheck
npm test
npm run build && node dist/bin.js --help
```

The test suite builds real temporary workspaces (Claude, Codex and Cursor configs, a fake home directory and npx
cache) and runs the full `init → lock → verify → drift → sync → verify` cycle.

Contributions are welcome: open an issue describing the agent configuration you want supported, ideally with a
minimal example of the files involved.

---

## License

[Apache-2.0](LICENSE)
