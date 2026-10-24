import { sha256 } from "../core/canonical.js";
import type { DriftCode, DriftEvent, Severity, VerificationReport } from "../types/model.js";
import { VERSION } from "../version.js";

/** Human descriptions for SARIF rule metadata. */
export const RULE_DESCRIPTIONS: Record<DriftCode, string> = {
  LOCK_MISSING: "The harnesslock.lock file is missing.",
  SPEC_HASH_MISMATCH: "harnesslock.yaml changed after harnesslock.lock was generated.",
  CONFIG_PARSE_ERROR: "An agent configuration file cannot be parsed.",
  AGENT_NOT_INSTALLED: "A required AI coding agent is not installed.",
  AGENT_VERSION_MISMATCH: "An installed agent version does not satisfy the configured range.",
  NO_ACTIVE_AGENT: "No configured agent is installed and compliant.",
  CROSS_AGENT_INSTRUCTION_DESYNC: "Instruction files shared across agents (e.g. CLAUDE.md and AGENTS.md) have diverged.",
  INSTRUCTION_HASH_MISMATCH: "An instruction file differs from its locked SHA-256 (strict-hash).",
  INSTRUCTION_DIRTY: "An instruction file has uncommitted modifications (git-clean).",
  INSTRUCTION_UNTRACKED: "An instruction file is not tracked by git (git-clean).",
  INSTRUCTION_MISSING: "A locked instruction file is missing.",
  MCP_UNKNOWN: "A project MCP server is not declared in harnesslock.yaml.",
  MCP_NOT_LOCKED: "A declared MCP server is missing from harnesslock.lock.",
  MCP_REMOVED: "A locked MCP server is no longer configured.",
  MCP_UNPINNED: "An MCP server is launched without an exact version pin.",
  MCP_VERSION_DRIFT: "An MCP server is pinned to a different version than harnesslock.lock.",
  MCP_VERSION_OUT_OF_RANGE: "The locked MCP version does not satisfy the requested range.",
  MCP_CONFIG_DRIFT: "An MCP server's command, arguments or environment changed.",
  MCP_SOURCE_CHANGED: "An MCP server now runs a different package.",
  MCP_ENV_MISSING: "A required environment variable is not passed to an MCP server.",
  MCP_DECLARED_NOT_CONFIGURED: "A declared MCP server is not configured in any agent.",
  SKILL_MISSING: "A required skill is missing.",
  SKILL_DRIFT: "Skill contents differ from harnesslock.lock.",
  SKILL_ADDED: "A skill exists that is not recorded in harnesslock.lock.",
  SKILL_REMOVED: "A locked skill was removed.",
  HOOK_MISSING: "A required hook is not configured.",
  HOOK_DRIFT: "A hook command or script differs from harnesslock.lock.",
  HOOK_ADDED: "A hook exists that is not recorded in harnesslock.lock.",
  HOOK_REMOVED: "A locked hook was removed.",
  RULE_DRIFT: "A rule file differs from harnesslock.lock.",
  RULE_ADDED: "A rule file exists that is not recorded in harnesslock.lock.",
  RULE_REMOVED: "A locked rule file was removed.",
  UNEXPECTED_PERMISSION: "A permission outside the approved policy was granted.",
  PERMISSION_GUARD_REMOVED: "A deny rule recorded in harnesslock.lock was removed.",
  USER_SCOPE_SHADOWING: "Unapproved user-scope MCP servers or hooks shadow the project configuration.",
  LOCAL_SCOPE_SHADOWING: "Unapproved project-local (uncommitted) MCP servers or hooks shadow the project configuration.",
};

function sarifLevel(severity: Severity): "error" | "warning" | "note" {
  return severity === "error" ? "error" : severity === "warning" ? "warning" : "note";
}

function isRepoPath(file: string | undefined): file is string {
  return file !== undefined && !file.startsWith("~") && !file.startsWith("/") && !/^[A-Za-z]:/.test(file);
}

function resultFor(event: DriftEvent) {
  const details = [event.expected !== undefined ? `expected: ${event.expected}` : "", event.actual !== undefined ? `actual: ${event.actual}` : ""]
    .filter(Boolean)
    .join("; ");
  const text = `[${event.componentId}] ${event.message}${details ? ` (${details})` : ""}${event.remediation ? ` — fix: ${event.remediation}` : ""}`;
  const location = isRepoPath(event.file)
    ? [
        {
          physicalLocation: {
            artifactLocation: { uri: event.file, uriBaseId: "%SRCROOT%" },
            region: { startLine: event.line ?? 1 },
          },
        },
      ]
    : [
        {
          physicalLocation: {
            artifactLocation: { uri: "harnesslock.yaml", uriBaseId: "%SRCROOT%" },
            region: { startLine: 1 },
          },
        },
      ];
  return {
    ruleId: event.code,
    level: sarifLevel(event.severity),
    message: { text },
    locations: location,
    partialFingerprints: {
      harnesslockEvent: sha256(`${event.code}|${event.componentId}|${event.file ?? ""}|${event.message}`).slice(7, 39),
    },
    properties: { section: event.section, component: event.componentId },
  };
}

/** SARIF v2.1.0 log for GitHub Code Scanning. */
export function toSarif(report: VerificationReport) {
  const codes = [...new Set(report.events.map((e) => e.code))].sort();
  return {
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: "HarnessLock",
            version: VERSION,
            semanticVersion: VERSION,
            informationUri: "https://github.com/harnesslock/harnesslock",
            rules: codes.map((code) => ({
              id: code,
              name: code
                .toLowerCase()
                .split("_")
                .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
                .join(""),
              shortDescription: { text: RULE_DESCRIPTIONS[code] },
              fullDescription: { text: RULE_DESCRIPTIONS[code] },
              helpUri: "https://github.com/harnesslock/harnesslock#drift-codes",
              defaultConfiguration: { level: sarifLevel(report.events.find((e) => e.code === code)?.severity ?? "warning") },
            })),
          },
        },
        results: report.events.map(resultFor),
        invocations: [{ executionSuccessful: report.exitCode !== 2 }],
      },
    ],
  };
}

export function renderSarif(report: VerificationReport): string {
  return `${JSON.stringify(toSarif(report), null, 2)}\n`;
}
