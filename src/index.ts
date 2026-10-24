/** Programmatic API for HarnessLock. */
export * from "./types/model.js";
export { VERSION } from "./version.js";

export {
  parseConfigText,
  resolveConfig,
  rawConfigSchema,
  ConfigValidationError,
  DEFAULT_POLICY,
  type RawConfig,
  type ResolvedConfig,
  type ResolvedPolicy,
} from "./schema/config-schema.js";
export { lockSchema, parseLockText, serializeLock, type HarnessLockFile, type LockMcpEntry } from "./schema/lock-schema.js";

export {
  canonicalize,
  canonicalizeInstruction,
  fingerprint,
  hashFileContent,
  hashInstruction,
  hashText,
  normalizeText,
  sha256,
} from "./core/canonical.js";
export {
  REDACTED,
  containsSecret,
  envFingerprintMaterial,
  isSecretName,
  looksLikeSecretValue,
  redactArgs,
  redactEnv,
  redactString,
} from "./core/redactor.js";
export {
  formatPinnedSpec,
  isExactVersion,
  locateInstalledNpmPackage,
  locateInstalledPythonPackage,
  parseMcpCommand,
  resolveCachedVersion,
  resolveInstalledNpmVersion,
  resolveInstalledPythonVersion,
  splitDockerImage,
  splitNpmSpec,
  splitPythonSpec,
  type ParsedMcpCommand,
  type ResolvedPackageVersion,
} from "./core/static-resolver.js";
export { evaluateInstructions, evaluateSyncGroup, readInstruction, syncInstructionGroup } from "./core/instruction-sync.js";
export { detectShadowing } from "./core/shadowing.js";
export { computeDrift, formatUnifiedDiff, lineDiff, type RawDriftEvent } from "./core/diff-engine.js";
export { applyPolicy, exitCodeFor, summarize } from "./core/policy-engine.js";
export { gitFileStates, parseGitIndex } from "./core/git-index.js";

export { ADAPTERS, ClaudeAdapter, CodexAdapter, CursorAdapter, detectAgents, getAdapter, scanScopes, scanWorkspace } from "./adapters/index.js";
export type { AgentAdapter, McpEdit, ScanContext, ScopeSource } from "./adapters/index.js";

export { createContext, HarnessLockError, loadProject, type CommandContext } from "./commands/context.js";
export { buildInitialConfig, renderInitialConfig, runInit } from "./commands/init.js";
export { collectScan, runScan } from "./commands/scan.js";
export { buildLockfile, lockWorkspace, runLock } from "./commands/lock.js";
export { formatReport, runVerify, verifyWorkspace, type OutputFormat, type VerifyOptions } from "./commands/verify.js";
export { runDiff } from "./commands/diff.js";
export { runSync, syncWorkspace, type SyncOptions } from "./commands/sync.js";
export { runStatus } from "./commands/status.js";
export { runDoctor } from "./commands/doctor.js";
export { installGitHooks, runInstallHooks } from "./commands/hooks.js";

export { renderVerifyReport, renderQuietBanner } from "./reporter/tui.js";
export { renderSarif, toSarif } from "./reporter/sarif.js";
export { renderMarkdown } from "./reporter/markdown.js";
